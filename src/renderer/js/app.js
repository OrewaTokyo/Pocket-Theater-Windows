// Start-up.
(async function () {
  const root = document.getElementById('root');
  try {
    PT.state.mediaBase = await PT.call('media:base');
    PT.state.info = await PT.call('app:info');
  } catch (err) {
    root.textContent = 'The app could not start: ' + err.message;
    return;
  }

  PT.on('conn:status', (status) => PT.shell.onStatus(status));
  PT.on('conn:signed-out', () => PT.shell.onSignedOut());

  // Ctrl+F jumps to the filter box of the folder you are looking at.
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey && event.key.toLowerCase() === 'f') || PT.viewer.isOpen()) return;
    const box = document.querySelector('input.filter');
    if (box) { event.preventDefault(); box.focus(); box.select(); }
  });

  let phones = [];
  try { phones = await PT.call('servers:list'); } catch (err) { /* treated as none */ }
  if (!phones.length) PT.views.addPhone({ first: true });
  else PT.enter(phones[0].id, phones[0].name); // the phone used last
})();
