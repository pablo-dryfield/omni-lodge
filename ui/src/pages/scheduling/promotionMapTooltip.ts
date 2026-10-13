export const createLeafletTooltipContent = (text: string): HTMLElement => {
  const content = document.createElement("span");
  content.textContent = text;
  return content;
};
