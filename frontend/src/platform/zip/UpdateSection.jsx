import { MaintenanceUpdateSection } from "../../pages/MaintenanceSections.jsx";

// 保留已经稳定的 ZIP updater/版本切换 UI；adapter 只负责选择与委托。
export default function ZipUpdateSection(props) {
  return <MaintenanceUpdateSection {...props} />;
}
