fn main() {
    println!("cargo:rerun-if-changed=native/Translate.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let target = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let arch = if target == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        let output = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap())
            .join("verseglade-translate");
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-parse-as-library",
                "-O",
                "-target",
                &format!("{arch}-apple-macos13.0"),
                "-Xlinker",
                "-weak_framework",
                "-Xlinker",
                "FoundationModels",
                "native/Translate.swift",
                "-o",
            ])
            .arg(output)
            .status()
            .expect("Xcode Swift compiler is required for Apple on-device translation");
        assert!(
            status.success(),
            "Could not compile Apple translation bridge"
        );
    }
    tauri_build::build()
}
