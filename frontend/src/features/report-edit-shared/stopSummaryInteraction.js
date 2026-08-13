// 放在 AccordionSummary / 可点击卡片标题行内的控件，需要拦截冒泡，
// 否则点击按钮或拖动手柄会连带触发折叠展开。
// 只阻止冒泡、不 preventDefault，因此不影响手柄的原生拖拽。
export const stopSummaryInteraction = {
  onClick: (event) => event.stopPropagation(),
  onMouseDown: (event) => event.stopPropagation(),
  onKeyDown: (event) => event.stopPropagation(),
  onFocus: (event) => event.stopPropagation(),
};

export default stopSummaryInteraction;
