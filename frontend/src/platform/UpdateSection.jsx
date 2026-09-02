import { platform } from "./index.js";
import TauriUpdateSection from "./tauri/UpdateSection.jsx";
import ZipUpdateSection from "./zip/UpdateSection.jsx";

const PlatformUpdateSection = platform.kind === "tauri" ? TauriUpdateSection : ZipUpdateSection;

export default function UpdateSection(props) {
  return <PlatformUpdateSection {...props} />;
}
