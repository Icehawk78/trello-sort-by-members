/* global TrelloPowerUp, APP_KEY, APP_NAME */

var KEEP_FROM_SOURCE = 'attachments,checklists,comments,customFields,labels,members,stickers';

var t = TrelloPowerUp.iframe({
  appKey: APP_KEY,
  appName: APP_NAME
});

// --- DOM references ---

var contentDiv = document.getElementById('content');
var loadingDiv = document.getElementById('loading');
var errorDiv = document.getElementById('error');
var startDateInput = document.getElementById('start-date');
var createBtn = document.getElementById('create-btn');
var progressText = document.getElementById('progress-text');
var progressFill = document.getElementById('progress-fill');
var errorText = document.getElementById('error-text');
var retryBtn = document.getElementById('retry-btn');

// --- Default date to today ---

startDateInput.value = new Date().toISOString().split('T')[0];

// --- UI state helpers ---

function showContent() {
  contentDiv.style.display = '';
  loadingDiv.style.display = 'none';
  errorDiv.style.display = 'none';
  return;
}

function showLoading(message) {
  contentDiv.style.display = 'none';
  loadingDiv.style.display = '';
  errorDiv.style.display = 'none';
  progressText.textContent = message;
  progressFill.style.width = '0%';
  return;
}

function showError(message) {
  contentDiv.style.display = 'none';
  loadingDiv.style.display = 'none';
  errorDiv.style.display = '';
  errorText.textContent = message;
  return;
}

function updateProgress(current, total) {
  var pct = Math.round((current / total) * 100);
  progressText.textContent = 'Copying card ' + current + ' of ' + total + '...';
  progressFill.style.width = pct + '%';
}

// --- Trello API helper ---

function trelloApi(method, path, body) {
  return t.getRestApi()
    .getToken()
    .then(function (token) {
      var url = 'https://api.trello.com/1' + path;
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      url += sep + 'key=' + APP_KEY + '&token=' + token;

      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json' }
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        opts.body = JSON.stringify(body);
      }

      return fetch(url, opts).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            throw new Error('API error ' + response.status + ': ' + text);
          });
        }
        return response.json();
      });
    });
}

// --- Date offset computation ---

function computeDateOffsets(cards) {
  var offsets = {};

  var cardsWithDue = cards.filter(function (c) { return c.due !== null; });
  if (cardsWithDue.length === 0) {
    return offsets;
  }

  // Find the earliest due date timestamp (the anchor)
  var earliestMs = cardsWithDue.reduce(function (earliest, c) {
    var ms = new Date(c.due).getTime();
    return ms < earliest ? ms : earliest;
  }, new Date(cardsWithDue[0].due).getTime());

  // Store raw ms offsets for each card with a due date
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (card.due === null) continue;

    var dueMs = new Date(card.due).getTime();

    var startGapMs = null;
    if (card.start !== null) {
      startGapMs = new Date(card.start).getTime() - dueMs;
    }

    offsets[card.id] = {
      offsetMs: dueMs - earliestMs,
      startGapMs: startGapMs
    };
  }

  return offsets;
}

// --- Parallel map with concurrency limit ---

function parallelMap(items, concurrency, fn) {
  var results = new Array(items.length);
  var index = 0;
  var active = 0;
  var finished = 0;

  return new Promise(function (resolve, reject) {
    function next() {
      while (active < concurrency && index < items.length) {
        (function (i) {
          active++;
          index++;
          fn(items[i], i)
            .then(function (result) {
              results[i] = result;
              active--;
              finished++;
              if (finished === items.length) {
                resolve(results);
              } else {
                next();
              }
            })
            .catch(function (err) {
              reject(err);
            });
        })(index);
      }
    }
    if (items.length === 0) {
      resolve(results);
    } else {
      next();
    }
  });
}

// --- Main copy workflow ---

function copyListAsTemplate(listId, newStartDateStr) {
  var newStartMs = new Date(newStartDateStr + 'T00:00:00').getTime();

  showLoading('Fetching list information...');

  return trelloApi('GET', '/lists/' + listId + '?fields=name,idBoard')
    .then(function (list) {
      showLoading('Fetching cards...');
      return trelloApi('GET', '/lists/' + listId + '/cards?fields=id,due,start,pos')
        .then(function (cards) {
          return { list: list, cards: cards };
        });
    })
    .then(function (data) {
      var cards = data.cards;
      var list = data.list;

      if (cards.length === 0) {
        throw new Error('The source list has no cards to copy.');
      }

      var offsets = computeDateOffsets(cards);

      showLoading('Creating new list...');
      return trelloApi('POST', '/lists', {
        name: list.name + ' (Copy)',
        idBoard: list.idBoard,
        pos: 'bottom'
      }).then(function (newList) {
        return { newList: newList, cards: cards, offsets: offsets };
      });
    })
    .then(function (data) {
      var newListId = data.newList.id;
      var cards = data.cards;
      var offsets = data.offsets;
      var total = cards.length;

      updateProgress(0, total);

      return parallelMap(cards, 8, function (card, i) {
        var cardBody = {
          idCardSource: card.id,
          idList: newListId,
          keepFromSource: KEEP_FROM_SOURCE,
          pos: card.pos
        };

        var offset = offsets[card.id];
        if (offset) {
          cardBody.due = new Date(newStartMs + offset.offsetMs).toISOString();
          if (offset.startGapMs !== null) {
            cardBody.start = new Date(newStartMs + offset.offsetMs + offset.startGapMs).toISOString();
          }
        } else {
          cardBody.due = null;
          cardBody.start = null;
        }

        return trelloApi('POST', '/cards', cardBody).then(function (newCard) {
          updateProgress(i + 1, total);
          return newCard;
        });
      });
    })
    .then(function () {
      t.closeModal();
    });
}

// --- Event handlers ---

createBtn.addEventListener('click', function () {
  var selectedDate = startDateInput.value;
  if (!selectedDate) {
    showError('Please select a start date.');
    return;
  }

  var listId = t.arg('listId');

  t.getRestApi()
    .isAuthorized()
    .then(function (isAuthorized) {
      if (!isAuthorized) {
        return t.modal({
          title: 'Authorize',
          url: './authorize.html',
          height: 200,
          accentColor: '#0079bf'
        });
      }

      return copyListAsTemplate(listId, selectedDate)
        .catch(function (err) {
          showError(err.message);
        });
    });
});

retryBtn.addEventListener('click', function () {
  showContent();
});

// --- Initial render ---

t.render(function () {});
