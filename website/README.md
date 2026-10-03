# Verseglade website

This is a static landing page. It uses plain HTML, CSS, and JavaScript, with no build step, package dependencies, remote fonts, or tracking scripts. Publish the contents of this directory with any static host.

## Release download links

The links in `index.html` point to GitHub's latest-release asset URLs and expect these exact filenames:

- `Verseglade-macOS-aarch64.dmg`
- `Verseglade-Windows-x64-setup.exe`
- `Verseglade-Linux-x64.AppImage`

The download and help links point to [VasiHemanth/verseglade](https://github.com/VasiHemanth/verseglade). Upload release assets with the exact names above for the download links to work. The buttons point to the expected URLs, but do not imply that those installers are currently available.

The macOS card is specifically for Apple silicon (`aarch64`). The Linux link expects an x64 AppImage.

The page detects Windows, macOS, or Linux and displays only the matching installer. Visitors can select another desktop platform from the manual picker. Mobile and unknown systems get a prompt to choose a desktop platform rather than an incorrect automatic download.
