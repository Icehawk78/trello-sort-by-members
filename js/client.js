var Promise = TrelloPowerUp.Promise;

var BLACK_ROCKET_ICON = 'https://cdn.glitch.com/1b42d7fe-bda8-4af8-a6c8-eff0cea9e08a%2Frocket-ship.png?1494946700421';

const memberSortable = card => {return card.members.length + card.members.map(m => m.fullName).sort()};
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

TrelloPowerUp.initialize({
  'list-actions': () => {},
  'list-sorters': (t) => {
    return t.list('name', 'id')
      .then(list => [memberSort])
  },
});
