# OmniLodge iOS (SwiftUI)

This is a SwiftUI starter app wired to the current Omni-Lodge API. It is generated with XcodeGen.

## Generate Xcode project (macOS)
1. Install XcodeGen: `brew install xcodegen`
2. From `ios/OmniLodge`, run: `xcodegen generate`
3. Open `OmniLodge.xcodeproj` in Xcode.

## Configure API base URL
- Update `OMNI_BASE_URL` in `project.yml` or override in Xcode build settings.

## Auth
- Login uses `/users/login` and stores the returned JWT in Keychain.
- All requests send `Authorization: Bearer <token>`.
