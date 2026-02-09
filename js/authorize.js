/* global TrelloPowerUp, APP_KEY, APP_NAME */

var t = TrelloPowerUp.iframe({
  appKey: APP_KEY,
  appName: APP_NAME
});

document.getElementById('auth-btn').addEventListener('click', function () {
  t.getRestApi()
    .authorize({ scope: 'read,write' })
    .then(function () {
      return t.closePopup();
    })
    .catch(function () {
      return t.closePopup();
    });
});

t.render(function () {
  t.sizeTo('body').done();
});
