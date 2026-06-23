/* global APP_KEY */

/* Shared Trello API and utility functions for modal pages. */

/**
 * Make an authenticated Trello REST API call.
 *
 * @param {object} t  TrelloPowerUp iframe instance
 * @param {string} method  HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path  API path starting with / (e.g. /lists/abc123)
 * @param {object} [body]  Request body for POST/PUT
 * @returns {Promise<object>}
 */
function trelloApi(t, method, path, body) {
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

/**
 * Run an async function over an array with a concurrency limit.
 *
 * @param {Array} items
 * @param {number} concurrency  Max parallel calls
 * @param {function} fn  Called with (item, index), must return a Promise
 * @returns {Promise<Array>}
 */
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

/**
 * Retry a Promise-returning function on failure with exponential backoff.
 *
 * @param {function} fn  Called with no args, must return a Promise
 * @param {number} [maxAttempts=3]
 * @param {number} [baseDelayMs=500]  Initial delay; doubles each retry
 * @returns {Promise}
 */
function withRetry(fn, maxAttempts, baseDelayMs) {
  maxAttempts = maxAttempts || 3;
  baseDelayMs = baseDelayMs || 500;

  function attempt(attemptsLeft, delayMs) {
    return fn().catch(function (err) {
      if (attemptsLeft <= 1) {
        throw err;
      }
      return new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      }).then(function () {
        return attempt(attemptsLeft - 1, delayMs * 2);
      });
    });
  }

  return attempt(maxAttempts, baseDelayMs);
}

/**
 * Escape a string for safe insertion into HTML.
 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
