// A short-lived "Deshacer" button inside a status line, after a destructive action.

let timer = null;

// `undo` reverts the action; `after` refreshes whatever shows the data.
export function offerUndo(node, message, undo, after) {
  clearTimeout(timer);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status__action";
  button.textContent = "Deshacer";
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    button.disabled = true;
    try {
      await undo();
      node.textContent = "Restaurado.";
    } catch (error) {
      node.dataset.kind = "error";
      node.textContent = error.message;
    }
    after();
  });
  node.dataset.kind = "ok";
  node.replaceChildren(message, " ", button);
  timer = setTimeout(() => {
    if (!node.contains(button)) return; // another message replaced the offer
    node.textContent = "";
    delete node.dataset.kind;
  }, 8000);
}
