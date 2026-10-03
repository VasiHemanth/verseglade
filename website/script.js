(() => {
  const year = document.querySelector("#year");
  if (year) year.textContent = new Date().getFullYear();

  const platformLinks = document.querySelectorAll("[data-platform]");
  const platform = `${navigator.userAgentData?.platform ?? navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  const currentPlatform = platform.includes("win")
    ? "windows"
    : platform.includes("linux")
      ? "linux"
      : platform.includes("mac")
        ? "macos"
        : null;
  if (currentPlatform) {
    for (const link of platformLinks) {
      if (link.dataset.platform === currentPlatform) {
        link.setAttribute("aria-current", "true");
        break;
      }
    }
  }
})();
