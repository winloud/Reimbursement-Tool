import { platform } from "./index.js";
import TauriRuntimeBoundary from "./tauri/RuntimeBoundary.jsx";
import ZipRuntimeBoundary from "./zip/RuntimeBoundary.jsx";

const Boundary = platform.kind === "tauri" ? TauriRuntimeBoundary : ZipRuntimeBoundary;

export default function RuntimeBoundary({ children }) {
  return <Boundary>{children}</Boundary>;
}
