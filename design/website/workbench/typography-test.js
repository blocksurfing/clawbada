document.querySelector('.type-system').addEventListener('click', (event) => {
  const button = event.target.closest('.demo-action');
  if (!button) return;
  document.querySelector('.feedback').textContent = `${button.textContent.trim()} clicked — typography demo only.`;
});
