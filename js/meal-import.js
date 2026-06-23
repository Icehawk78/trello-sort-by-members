/* global TrelloPowerUp, APP_KEY, APP_NAME, trelloApi, parallelMap, withRetry, escapeHtml */

const t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: APP_NAME });

// --- DOM references ---

const phaseDivs = {
  config: document.getElementById('config'),
  import: document.getElementById('import'),
  review: document.getElementById('review'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error')
};

const templateListSelect = document.getElementById('template-list');
const prepListSelect = document.getElementById('prep-list');
const cleanupListSelect = document.getElementById('cleanup-list');
const mealDataTextarea = document.getElementById('meal-data');
const importBtn = document.getElementById('import-btn');
const reviewBody = document.getElementById('review-body');
const reviewSummary = document.getElementById('review-summary');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const errorText = document.getElementById('error-text');

let mealPrepLabelId = null;
let mealCleanupLabelId = null;
let pointsFieldId = null;
let currentMatchResult = null;

// --- Phase switching ---

function showPhase(name) {
  Object.keys(phaseDivs).forEach(id => {
    phaseDivs[id].style.display = id === name ? '' : 'none';
  });
}

function showError(msg) {
  showPhase('error');
  errorText.textContent = msg;
}

// --- Parsing ---

function parseDate(str) {
  // Append current year if not present, since formats like
  // "Thu, Feb 26" don't include one
  const withYear = str.match(/\d{4}/) ? str : str + ' ' + new Date().getFullYear();
  const date = new Date(withYear);
  if (isNaN(date.getTime())) {
    return null;
  }

  // 1PM to avoid timezone day-shift
  date.setHours(13, 0, 0, 0);
  return date;
}

function parseMealData(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const tab = line.indexOf('\t');
      if (tab < 0) {
        return null;
      }
      const date = parseDate(line.substring(0, tab).trim());
      const name = line.substring(tab + 1).trim();
      if (!date || !name) {
        return null;
      }
      return { date: date, name: name };
    })
    .filter(meal => meal !== null);
}

// --- Fuzzy matching ---

function bigrams(str) {
  const result = [];
  for (let i = 0; i < str.length - 1; i++) {
    result.push(str.charAt(i) + str.charAt(i + 1));
  }
  return result;
}

function diceSimilarity(a, b) {
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  const bCounts = bBigrams.reduce((counts, bg) => {
    counts[bg] = (counts[bg] || 0) + 1;
    return counts;
  }, {});

  const matches = aBigrams.reduce((count, bg) => {
    if (bCounts[bg] > 0) {
      bCounts[bg]--;
      return count + 1;
    }
    return count;
  }, 0);

  return (2 * matches) / (aBigrams.length + bBigrams.length);
}

// --- Template matching ---

function normalize(s) {
  return s.replace(/^\./, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function findMatch(key, map) {
  if (map[key]) {
    return { type: 'exact', template: map[key] };
  }

  // Collect all candidates: substring matches score 1, dice matches score normally
  const candidates = Object.keys(map).map(k => {
    const isSubstring = k.indexOf(key) >= 0 || key.indexOf(k) >= 0;
    const score = isSubstring ? 1 : diceSimilarity(key, k);
    return { template: map[k], score: score };
  })
  .filter(c => c.score >= 0.6)
  .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { type: 'none', template: null };
  }

  return {
    type: 'fuzzy',
    template: candidates[0].template,
    candidates: candidates.map(c => c.template)
  };
}

function matchMealsToTemplates(meals, templateCards) {
  const prepMap = {};
  const cleanupMap = {};

  templateCards.forEach(card => {
    const labelIds = (card.labels || []).map(l => l.id);
    if (mealPrepLabelId && labelIds.indexOf(mealPrepLabelId) >= 0) {
      prepMap[normalize(card.name)] = card;
    }
    if (mealCleanupLabelId && labelIds.indexOf(mealCleanupLabelId) >= 0) {
      cleanupMap[normalize(card.name)] = card;
    }
  });

  return meals.map(meal => {
    const key = normalize(meal.name);
    return {
      meal: meal,
      prep: findMatch(key, prepMap),
      cleanup: findMatch(key, cleanupMap)
    };
  });
}

// --- Review rendering ---

function renderMatchCell(type, idx, match) {
  if (match.type === 'exact') {
    return '<span class="badge badge-matched">' + escapeHtml(match.template.name) + '</span>';
  }

  let html = '';
  if (match.type === 'fuzzy') {
    if (match.candidates.length > 1) {
      html += '<select class="match-select" data-match="' + type + '-' + idx + '">';
      match.candidates.forEach(c => {
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      });
      html += '</select>';
    } else {
      html += '<span class="badge badge-suggested">' + escapeHtml(match.template.name) + '</span>';
    }
  } else {
    html += '<span class="badge badge-new">New</span>';
    if (pointsFieldId) {
      html += ' <input type="number" class="points-input" data-points="'
        + type + '-' + idx + '" placeholder="Pts" min="0">';
    }
  }
  html += ' <label class="skip-label"><input type="checkbox" data-skip="'
    + type + '-' + idx + '"> Skip</label>';
  return html;
}

function renderReview(result) {
  currentMatchResult = result;

  const counts = result.reduce((acc, row) => {
    ['prep', 'cleanup'].forEach(type => {
      if (row[type].type === 'exact') {
        acc.exact++;
      } else if (row[type].type === 'fuzzy') {
        acc.fuzzy++;
      } else {
        acc.unmatched++;
      }
    });
    return acc;
  }, { exact: 0, fuzzy: 0, unmatched: 0 });

  reviewBody.innerHTML = result.map((row, i) => {
    const hasNew = row.prep.type === 'none' || row.cleanup.type === 'none';
    const dateStr = (row.meal.date.getMonth() + 1) + '/' + row.meal.date.getDate();

    let templateCol = '';
    if (hasNew) {
      templateCol = '<label><input type="checkbox" data-save-template="' + i + '"> Save</label>';
    }

    return '<tr>'
      + '<td>' + escapeHtml(dateStr) + '</td>'
      + '<td>' + escapeHtml(row.meal.name) + '</td>'
      + '<td>' + renderMatchCell('prep', i, row.prep) + '</td>'
      + '<td>' + renderMatchCell('cleanup', i, row.cleanup) + '</td>'
      + '<td class="template-cell">' + templateCol + '</td>'
      + '</tr>';
  }).join('');

  const total = counts.exact + counts.fuzzy + counts.unmatched;
  reviewSummary.textContent = total + ' cards: '
    + counts.exact + ' matched, '
    + counts.fuzzy + ' suggested, '
    + counts.unmatched + ' new';
}

// --- Card creation ---

function createSingleCard(task) {
  const due = task.meal.date.toISOString();
  const KEEP = 'attachments,checklists,comments,customFields,labels,members,stickers';

  // Copy from existing template
  if (task.match.type !== 'none') {
    return trelloApi(t, 'POST', '/cards', {
      idCardSource: task.match.template.id,
      keepFromSource: KEEP,
      idList: task.listId,
      due: due
    });
  }

  // Create new card
  const cardName = task.cardType === 'prep' ? '.' + task.meal.name : task.meal.name;
  const idLabels = task.labelId ? [task.labelId] : [];

  return trelloApi(t, 'POST', '/cards', {
    name: cardName,
    idList: task.listId,
    idLabels: idLabels,
    due: due
  }).then(card => {
    if (task.points && pointsFieldId) {
      return trelloApi(t, 'PUT',
        '/cards/' + card.id + '/customField/' + pointsFieldId + '/item',
        { value: { number: String(task.points) } }
      ).then(() => card);
    }
    return card;
  }).then(card => {
    if (!task.saveTemplate) {
      return card;
    }
    return trelloApi(t, 'POST', '/cards', {
      name: cardName,
      idList: templateListSelect.value,
      idLabels: idLabels
    }).then(templateCard => {
      let p = Promise.resolve();
      if (task.points && pointsFieldId) {
        p = trelloApi(t, 'PUT',
          '/cards/' + templateCard.id + '/customField/' + pointsFieldId + '/item',
          { value: { number: String(task.points) } }
        );
      }
      return p.then(() => {
        return trelloApi(t, 'PUT', '/cards/' + templateCard.id, { isTemplate: true });
      });
    }).then(() => card);
  });
}

function collectTasks() {
  return currentMatchResult.reduce((tasks, row, i) => {
    const saveTemplateCheckbox = document.querySelector('[data-save-template="' + i + '"]');
    const saveTemplate = saveTemplateCheckbox ? saveTemplateCheckbox.checked : false;

    ['prep', 'cleanup'].forEach(type => {
      const skipCheckbox = document.querySelector('[data-skip="' + type + '-' + i + '"]');
      if (skipCheckbox && skipCheckbox.checked) {
        return;
      }

      // If user picked a different candidate from the dropdown, use that
      let match = row[type];
      const matchSelect = document.querySelector('[data-match="' + type + '-' + i + '"]');
      if (matchSelect && match.candidates) {
        const selected = match.candidates.find(c => c.id === matchSelect.value);
        if (selected) {
          match = { type: 'fuzzy', template: selected };
        }
      }

      const pointsInput = document.querySelector('[data-points="' + type + '-' + i + '"]');
      tasks.push({
        meal: row.meal,
        match: match,
        cardType: type,
        listId: type === 'prep' ? prepListSelect.value : cleanupListSelect.value,
        labelId: type === 'prep' ? mealPrepLabelId : mealCleanupLabelId,
        points: pointsInput ? pointsInput.value : null,
        saveTemplate: saveTemplate && row[type].type === 'none'
      });
    });

    return tasks;
  }, []);
}

// --- Event handlers ---

document.getElementById('save-config-btn').addEventListener('click', () => {
  t.set('board', 'private', {
    templateListId: templateListSelect.value,
    prepListId: prepListSelect.value,
    cleanupListId: cleanupListSelect.value
  });
  showPhase('import');
});

document.getElementById('config-btn').addEventListener('click', () => {
  showPhase('config');
});

document.getElementById('import-btn').addEventListener('click', () => {
  const meals = parseMealData(mealDataTextarea.value);
  if (meals.length === 0) {
    showError('Could not parse any meals. Expected format: date<tab>meal name');
    return;
  }

  importBtn.disabled = true;

  trelloApi(t, 'GET', '/lists/' + templateListSelect.value
    + '/cards?fields=id,name,labels&customFieldItems=true')
    .then(cards => {
      importBtn.disabled = false;
      renderReview(matchMealsToTemplates(meals, cards));
      showPhase('review');
    })
    .catch(err => {
      importBtn.disabled = false;
      showError(err.message);
    });
});

document.getElementById('create-btn').addEventListener('click', () => {
  t.getRestApi().isAuthorized().then(isAuthorized => {
    if (!isAuthorized) {
      return t.modal({
        title: 'Authorize',
        url: './authorize.html',
        height: 200,
        accentColor: '#0079bf'
      });
    }

    const tasks = collectTasks();
    if (tasks.length === 0) {
      showError('No cards to create.');
      return;
    }

    showPhase('loading');
    progressText.textContent = 'Creating cards...';
    progressFill.style.width = '0%';
    const total = tasks.length;
    let completed = 0;

    return parallelMap(tasks, 8, (task) => {
      return withRetry(() => createSingleCard(task)).then(result => {
        completed++;
        const pct = Math.round((completed / total) * 100);
        progressText.textContent = 'Creating card ' + completed + ' of ' + total + '...';
        progressFill.style.width = pct + '%';
        return result;
      });
    })
    .then(() => {
      t.closeModal();
    })
    .catch(err => {
      showError(err.message);
    });
  });
});

document.getElementById('back-btn').addEventListener('click', () => {
  showPhase('import');
});

document.getElementById('retry-btn').addEventListener('click', () => {
  showPhase('import');
});

// --- Initialization ---

t.render(() => {
  t.getRestApi().isAuthorized().then(isAuthorized => {
    if (!isAuthorized) {
      return t.modal({
        title: 'Authorize',
        url: './authorize.html',
        height: 200,
        accentColor: '#0079bf'
      });
    }

    const boardId = t.getContext().board;
    return Promise.all([
      trelloApi(t, 'GET', '/boards/' + boardId + '/lists?filter=open&fields=id,name'),
      trelloApi(t, 'GET', '/boards/' + boardId + '/labels?fields=id,name'),
      trelloApi(t, 'GET', '/boards/' + boardId + '/customFields'),
      t.get('board', 'private')
    ]).then(res => {
      const lists = res[0];
      const labels = res[1];
      const fields = res[2];
      const saved = res[3] || {};

      labels.forEach(l => {
        if (l.name === 'Meal Prep') {
          mealPrepLabelId = l.id;
        }
        if (l.name === 'Meal Cleanup') {
          mealCleanupLabelId = l.id;
        }
      });

      fields.forEach(f => {
        if (f.name === 'Points') {
          pointsFieldId = f.id;
        }
      });

      const opts = lists.map(l => {
        return '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>';
      }).join('');

      templateListSelect.innerHTML = opts;
      prepListSelect.innerHTML = opts;
      cleanupListSelect.innerHTML = opts;

      // Restore saved selections, falling back to name heuristic
      if (saved.templateListId) {
        templateListSelect.value = saved.templateListId;
      } else {
        lists.forEach(l => {
          if (l.name.toLowerCase().indexOf('template') >= 0) {
            templateListSelect.value = l.id;
          }
        });
      }

      if (saved.prepListId) {
        prepListSelect.value = saved.prepListId;
      } else {
        lists.forEach(l => {
          const name = l.name.toLowerCase();
          if (name.indexOf('prep') >= 0 && name.indexOf('template') < 0) {
            prepListSelect.value = l.id;
          }
        });
      }

      if (saved.cleanupListId) {
        cleanupListSelect.value = saved.cleanupListId;
      } else {
        lists.forEach(l => {
          const name = l.name.toLowerCase();
          if (name.indexOf('cleanup') >= 0 && name.indexOf('template') < 0) {
            cleanupListSelect.value = l.id;
          }
        });
      }

      if (saved.templateListId) {
        showPhase('import');
      } else {
        showPhase('config');
      }
    });
  }).catch(err => {
    showError('Failed to load board data: ' + err.message);
  });
});
