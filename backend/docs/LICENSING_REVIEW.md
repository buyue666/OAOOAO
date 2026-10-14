# OAOOAO implementation and licensing record

Review date: 2026-10-14. This document records implementation sources, publication
decisions and remaining review boundaries. It is not a legal opinion, a formal
clean-room certification, or a guarantee against infringement claims.

## Application and source publication

The OAOOAO owner commissioned this backend from a functional specification and
the existing client's HTTP contracts. Module implementers used this repository,
the permitted interoperability contracts and official documentation. Their
source records are maintained in the module provenance documents. The
coordinator had prior exposure to other implementations; the project does not
claim that every participant worked under formal clean-room conditions.

The application was initially private. On 2026-10-14 the owner authorized its
publication under **AGPL-3.0-only**, after excluding credentials and business
data. The unmodified root `LICENSE` contains the governing application license.
The public backend is a reviewed source snapshot in the `backend/` directory of
https://github.com/buyue666/OAOOAO, alongside the frontend at the repository root.
Source, migrations, dependency locks and build scripts are included. Earlier
private backend Git history is not part of that snapshot and is not needed to
build the released application.

This backend's provenance does not establish the authorship or rights status of
every frontend component, visual design, user upload or externally supplied asset.

## Third-party components and notices

Application licensing does not replace the licenses of dependencies, tools,
system packages, fonts or separately supplied assets. Preserve the original
copyright and license notices distributed with those components.

| Component | Review and distribution boundary |
| --- | --- |
| Runtime npm dependencies | `package-lock.json` pins the dependency set. `THIRD_PARTY_DEPENDENCY_NOTICES.txt` records the located license notices; regenerate it with `node scripts/dependency-notices.mjs` and review changes when dependencies change. |
| Build and development tools | Their licenses remain applicable to the tools and any material included in a distribution. Development-only dependencies are excluded from the production npm installation. |
| FFmpeg, system libraries and fonts | The runtime invokes Debian FFmpeg as a separate executable; that distribution includes GPL components. Preserve the distribution's copyright files and review the applicable source and notice requirements when distributing containers or binaries. |
| External models, providers and uploaded content | Provider terms and the rights to inputs or outputs require separate review. The application license does not grant rights to third-party services or content. |

## Scope and retained evidence

Detailed historical licensing and deployment review evidence is retained in the
operator's private audit archive. The original report is preserved byte for byte
with a SHA-256 record; its removal from the public documentation does not erase
its findings or any obligations associated with earlier releases.

Publishing this implementation does not retroactively resolve obligations from
previous deployments. Preserve prior release evidence and necessary notices,
and obtain qualified advice for historical source requests or rights-holder
agreements. Credentials and customer records must not be included in a public
source snapshot.

Source comparison results and engineering provenance records are evidence for
review, not a legal safe harbor. They cannot exclude all semantic derivation,
unreviewed assets, design rights, trademark issues, patents or authorship errors.
User-supplied template archives and artwork have not received a complete chain
of rights review. Do not describe the entire product as free of all legal risk.

## Primary references

- GNU AGPL version 3: https://www.gnu.org/licenses/agpl-3.0.en.html
- MIT license: https://opensource.org/license/mit
- FFmpeg licensing and build configuration: https://ffmpeg.org/legal.html
- Current application license: `LICENSE`
- Dependency notices: `THIRD_PARTY_DEPENDENCY_NOTICES.txt`
