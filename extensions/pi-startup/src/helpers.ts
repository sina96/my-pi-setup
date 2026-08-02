import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function hasNerdFonts(): boolean {
  if (process.env.PI_STARTUP_NERD_FONTS === "1") return true;
  if (process.env.PI_STARTUP_NERD_FONTS === "0") return false;
  if (process.env.GHOSTTY_RESOURCES_DIR) return true;

  const terminal = `${process.env.TERM_PROGRAM ?? ""} ${process.env.TERM ?? ""}`.toLowerCase();
  return ["iterm", "wezterm", "kitty", "ghostty", "alacritty", "foot", "rio", "contour"]
    .some((name) => terminal.includes(name));
}

export function fit(value: string, width: number): string {
  const current = visibleWidth(value);
  if (current > width) return truncateToWidth(value, width, "…");
  return value + " ".repeat(width - current);
}

export function center(value: string, width: number): string {
  const current = visibleWidth(value);
  if (current >= width) return truncateToWidth(value, width, "…");
  const left = Math.floor((width - current) / 2);
  return " ".repeat(left) + value + " ".repeat(width - current - left);
}
