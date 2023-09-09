var Promise = TrelloPowerUp.Promise;

var BLACK_ROCKET_ICON = 'https://cdn.glitch.com/1b42d7fe-bda8-4af8-a6c8-eff0cea9e08a%2Frocket-ship.png?1494946700421';

const memberSort = {
  text: "Members",
  callback: (t, list) => {
    return {
      sortedIds: list
        .cards
        .sort(card => card.members.length + card.members.map(m => m.fullName))
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
