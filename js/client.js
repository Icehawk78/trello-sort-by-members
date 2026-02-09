/* global TrelloPowerUp, APP_KEY, APP_NAME */

var Promise = TrelloPowerUp.Promise;

var BLACK_ROCKET_ICON = 'https://cdn.glitch.com/1b42d7fe-bda8-4af8-a6c8-eff0cea9e08a%2Frocket-ship.png?1494946700421';

const hasHardcodedCustomField = card => {
  let cf = card.customFieldItems.find(x => x.idCustomField == '5eaddba59611477cad5de0ce');
  return cf && cf.value.checked == 'true';
}
const memberSortable = card => {return (hasHardcodedCustomField(card) ? '1' : '0') + card.members.length + card.members.map(m => m.fullName).sort()};
const memberSort = {
  text: "Members",
  callback: (t, list) => {
    return {
      sortedIds: list
        .cards
        .sort((a,b) => {
            const a1 = memberSortable(a);
            const b1 = memberSortable(b);
            return a1 < b1 ? -1 : (b1 > a1 ? 1 : 0);
        })
        .map(c => c.id)
    };
  },
}

TrelloPowerUp.initialize(
  {
    'list-actions': function (t) {
      return [
        {
          text: 'Copy as Template...',
          callback: function (t) {
            return t.popup({
              title: 'Pick a Start Date',
              url: './pick-date.html',
              args: { listId: t.getContext().list },
              height: 200
            });
          }
        }
      ];
    },
    'list-sorters': (t) => {
      return t.list('name', 'id')
        .then(list => [memberSort])
    },
  },
  {
    appKey: APP_KEY,
    appName: APP_NAME
  }
);
