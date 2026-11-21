# Image slots

These slots are filled with the designer-supplied artwork. The pages render the files below with `next/image`.

| Path | Pixels | Aspect | What it depicts |
|---|---|---|---|
| `web/public/images/hero-home.webp` | 1440×1080 | 4:3 | A small Indian shop counter. Someone sends a GST invoice from a phone while a customer pays by UPI. No words baked into the picture. |
| `web/public/images/feature-invoices.webp` | 960×640 | 3:2 | An invoice drafted in under a minute: customer, line items, GST total. |
| `web/public/images/feature-payments.webp` | 960×640 | 3:2 | The same bill collected by UPI, card, net banking, or cash. |
| `web/public/images/feature-reminders.webp` | 960×640 | 3:2 | A polite follow-up for an overdue invoice, on a phone. |
| `web/public/images/feature-recurring.webp` | 960×640 | 3:2 | A monthly or yearly bill that goes out on its own. |
| `web/public/images/feature-dashboard.webp` | 960×640 | 3:2 | Paid, pending, and overdue amounts on one screen. |
| `web/public/images/feature-team.webp` | 960×640 | 3:2 | An owner, an accountant, and a staff member, each with different access. |
| `web/public/images/feature-security.webp` | 960×640 | 3:2 | A vault with ledgers, a shield, and padlocks. |
| `dashboard/public/images/template-classic.webp` | 1280×800 | 8:5 | Classic public page: centered name, short tagline, quiet layout. |
| `dashboard/public/images/template-modern.webp` | 1280×800 | 8:5 | Modern public page: split hero, stronger accent, still a real shop. |
| `dashboard/public/images/template-minimal.webp` | 1280×800 | 8:5 | Minimal public page: lots of space, one line of type, no decoration. |

## Pending intro slides

These slots are not filled yet. The intro uses icon and brand-shape compositions until Image Generator supplies the files. Do not ship a blank box or a generated stand-in in their place.

| Path | Pixels | Aspect | What it depicts | Status |
|---|---|---|---|---|
| `dashboard/public/images/intro-bill.webp` | 1080×1080 | 1:1 | A shopkeeper taps a large green New bill control on a phone at the counter. No words in the art. | Pending |
| `dashboard/public/images/intro-upi.webp` | 1080×1080 | 1:1 | Cash in one hand and a UPI QR on the counter. No words in the art. | Pending |
| `dashboard/public/images/intro-ledger.webp` | 1080×1080 | 1:1 | An open shop ledger, the kind a Bengali shop calls খাতা. No words in the art. | Pending |
| `dashboard/public/images/intro-vault.webp` | 1080×1080 | 1:1 | A closed ledger kept in a small shop safe. No words in the art. | Pending |

Brand files (logo, favicon, Open Graph) are not slots. They live under `web/public/brand` and `dashboard/public/brand`.

The storefront split-hero panel is an empty accent border drawn by `@billflow/storefront`. It is not one of these image slots.
