# Yellow Beast desktop alpha distribution

YB-26 produces unsigned native Electron zip artifacts named `Yellow Beast`.
They bundle their own runtime: users do not need Node, npm, Git, or a checkout.

| Platform | Artifact | Validation | Signing |
| --- | --- | --- | --- |
| macOS arm64 | `Yellow Beast-<version>-arm64-mac.zip` | packaged offline four-mode/save-resume smoke | unsigned; Gatekeeper handling remains a release-operation task |
| Windows | `Yellow Beast-<version>-<arch>-win.zip` | packaged offline four-mode/save-resume smoke in Windows CI | unsigned alpha unless a real certificate is supplied |

The app stores worlds in platform application data, not its install directory.
Offline / Structured play is the default. Exported worlds contain only portable
world data and never provider credentials, settings, logs, or machine paths.

The alpha currently uses Electron's generic application icon while a reviewed
Yellow Beast mark is prepared; it has no effect on the bundled runtime or
world-save format.

For this alpha, package verification runs Yellow Beast from the bundled Electron
runtime in non-GUI smoke mode; normal graphical Finder/Windows launch is the
fresh-user follow-up checked by the native CI packaging jobs. Auto-update and
code signing are intentionally deferred.
