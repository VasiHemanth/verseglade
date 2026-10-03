(() => {
  const year = document.querySelector("#year");
  if (year) year.textContent = new Date().getFullYear();

  const select = document.querySelector("#platform-select");
  const platformName = document.querySelector("#download-platform-name");
  const architecture = document.querySelector("#download-architecture");
  const description = document.querySelector("#download-description");
  const icon = document.querySelector("#platform-icon");
  const link = document.querySelector("#download-link");
  const label = document.querySelector("#download-label");
  const unavailable = document.querySelector("#download-unavailable");
  const status = document.querySelector("#download-status");
  if (!select || !platformName || !architecture || !description || !icon || !link || !label || !unavailable || !status) return;

  const downloads = {
    macos: {
      name: "macOS",
      architecture: "Apple silicon",
      description: "Disk image for Apple silicon Macs.",
      file: "Verseglade-macOS-aarch64.dmg",
      label: "Download for Mac · .dmg",
      icon: "⌘",
      iconClass: "apple-icon",
    },
    windows: {
      name: "Windows",
      architecture: "x64",
      description: "Setup installer for 64-bit Windows.",
      file: "Verseglade-Windows-x64-setup.exe",
      label: "Download for Windows · .exe",
      icon: "⊞",
      iconClass: "windows-icon",
    },
    linux: {
      name: "Linux",
      architecture: "x64",
      description: "Portable AppImage for x64 Linux.",
      file: "Verseglade-Linux-x64.AppImage",
      label: "Download for Linux · AppImage",
      icon: "◈",
      iconClass: "linux-icon",
    },
  };

  const platformInfo = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  function detectPlatform() {
    const platform = `${platformInfo} ${userAgent}`.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(platform)) return null;
    if (/windows|win32|win64/.test(platform)) return "windows";
    if (/macintosh|mac os|macintel|macppc|mac68k/.test(platform)) return "macos";
    if (/linux|x11|cros/.test(platform)) return "linux";
    return null;
  }

  const detectedPlatform = detectPlatform();
  function render(platform, automatic) {
    const download = downloads[platform];
    select.value = automatic && detectedPlatform ? "auto" : platform ?? "auto";
    unavailable.hidden = Boolean(download);
    link.hidden = !download;
    if (download) {
      platformName.textContent = download.name;
      architecture.textContent = download.architecture;
      description.textContent = download.description;
      icon.textContent = download.icon;
      icon.className = `platform-icon ${download.iconClass}`;
      label.textContent = download.label;
      link.href = `https://github.com/VasiHemanth/verseglade/releases/latest/download/${download.file}`;
      status.textContent = automatic
        ? `Detected ${download.name}. Choose another platform if you’re downloading for a different computer.`
        : `Showing the ${download.name} installer.`;
    } else {
      platformName.textContent = "Choose a platform";
      architecture.textContent = "";
      description.textContent = "Select the operating system for the computer where you’ll install Verseglade.";
      icon.textContent = "↓";
      icon.className = "platform-icon";
      label.textContent = "Download installer";
      link.removeAttribute("href");
      status.textContent = "We couldn’t detect your operating system. Select macOS, Windows, or Linux to see its installer.";
    }
  }

  render(detectedPlatform, true);
  select.addEventListener("change", () => {
    render(select.value === "auto" ? detectedPlatform : select.value, select.value === "auto");
  });
})();
