export const reportPaginationLabels = {
  labelRowsPerPage: "每页条数",
  labelDisplayedRows: ({ from, to, count }) =>
    count === 0 ? "共 0 条" : `第 ${from}–${to} 条，共 ${count === -1 ? `超过 ${to}` : count} 条`,
  getItemAriaLabel: (type) => ({
    first: "首页",
    last: "末页",
    next: "下一页",
    previous: "上一页",
  })[type],
};

export function getReportListEmptyMessage({ name, isTrash, hasFilters, statusLabel }) {
  if (hasFilters) {
    return {
      title: `没有符合条件的${name}`,
      description: "请调整或清除筛选条件后重试。",
    };
  }
  if (isTrash) {
    return { title: "回收站为空", description: `删除的${name}会显示在这里。` };
  }
  if (statusLabel) {
    return { title: `暂无${statusLabel}的${name}`, description: "可以切换到“全部”查看其他状态的报销单。" };
  }
  return { title: `暂无${name}`, description: "点击“新增报销单”开始填写。" };
}
