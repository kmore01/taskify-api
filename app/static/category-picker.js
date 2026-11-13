// Category field shared by the list and calendar task forms: a real <select>
// with every existing category, plus "Nueva categoría…" to type a new one.
// (A <datalist> only suggests matches for the current text, so editing a task
// that already had a category hid every other option.)

const NEW = "__new__";

export function makeCategoryPicker(current = "", categories = []) {
  const wrap = document.createElement("div");
  wrap.className = "cat-picker";

  const select = document.createElement("select");
  select.className = "sort-select";
  select.setAttribute("aria-label", "Categoría");
  select.add(new Option("Sin categoría", ""));
  const names = current && !categories.includes(current) ? [...categories, current] : categories;
  for (const name of names) select.add(new Option(name, name));
  select.add(new Option("Nueva categoría…", NEW));
  select.value = current || "";

  const selectWrap = document.createElement("span");
  selectWrap.className = "select";
  selectWrap.append(select);

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.placeholder = "Nombre de la nueva categoría";
  input.setAttribute("aria-label", "Nueva categoría");
  input.hidden = true;

  select.addEventListener("change", () => {
    input.hidden = select.value !== NEW;
    if (!input.hidden) input.focus();
  });

  wrap.append(selectWrap, input);
  return {
    node: wrap,
    getValue: () => (select.value === NEW ? input.value.trim() : select.value),
  };
}
