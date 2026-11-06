# Windows security warnings

Burrow programs are not code-signed yet. A new, unsigned program has no reputation with Windows, so two things can happen.

## "Windows protected your PC" (SmartScreen)

Click `More info`, then `Run anyway`. This message appears for any program without a known publisher and goes away as a signed program gains reputation.

## Defender reports a threat (names ending in `!ml`)

Microsoft Defender uses a machine-learning heuristic on new files. The Hub downloads archives, unpacks them, starts programs and replaces itself when it updates, which is also what some malware does, so a young unsigned build can be flagged by mistake.

What the Hub does and does not do:

- It contacts the network only after you agree to check for updates.
- Every download is described by a manifest signed with an Ed25519 key (the public key is published with each release). The signature and the SHA-256 of each archive are checked before anything is unpacked.
- It does not install a service, a scheduled task or an autorun entry, and it never asks for administrator rights.
- It sends no telemetry.

If Defender flags a file:

1. Compare the file's SHA-256 with the one on the download page (`certutil -hashfile <file> SHA256`).
2. If they match, open Windows Security, `Protection history`, select the item and choose `Restore` (or `Allow on device`).
3. You can also report it to Microsoft as a false positive at the Security Intelligence submission page so the detection is reviewed.

If the sums do not match, delete the file and download it again from the official site.
