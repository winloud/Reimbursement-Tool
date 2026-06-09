const SOURCE_ORDER = ["system", "bundled"];
const SOURCE_LABELS = {
  system: "系统字体",
  bundled: "项目内置字体",
};

export const groupFontsBySource = (fonts = []) => {
  const buckets = new Map();
  fonts.forEach((font) => {
    const source = SOURCE_ORDER.includes(font.source) ? font.source : "bundled";
    if (!buckets.has(source)) {
      buckets.set(source, {
        source,
        label: font.source_label || SOURCE_LABELS[source],
        fonts: [],
      });
    }
    buckets.get(source).fonts.push(font);
  });
  return SOURCE_ORDER.filter((source) => buckets.has(source)).map((source) => buckets.get(source));
};
