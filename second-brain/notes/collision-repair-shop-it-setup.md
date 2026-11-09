# Collision repair shop IT setup

- **Last updated:** 2026-11-09
- **Related:** [memory.md](../memory.md)

## Summary

The shop's IT runs on several separate systems that don't talk to each other:
T21 on a local Windows Server, a Cisco Meraki VPN, a network printer, Telstra
for mobiles, Google Drive and Outlook. Setting up a new employee means about
five separate manual jobs; nothing provisions everything from one console.

## Systems

| System | What it does | How access is granted |
|---|---|---|
| **T21** | Shop management software | Runs on a local Windows Server. There is no separate T21 login: access comes from the person's Windows user account (Active Directory, or local users on a standalone server), group membership and a T21 role/profile. |
| **Windows Server** | Hosts T21 and user accounts | Done at the server over RDP or console. New accounts get a temporary password that must be changed at first login. |
| **Cisco Meraki client VPN** | Remote / second-site access | Set up in the Meraki dashboard, separately from the Windows account. Connection details go to the user through a secure channel, never plain email. Test from the user's laptop before calling it done. The step most often forgotten. |
| **Network printer** | Standard shop printer | Added on each workstation by IP or network browse, with the right driver; print a test page. |
| **Telstra** | Company mobiles / eSIM | Requested by email to Telstra. Needs the employee's name, start date and personal mobile number. Not every shop-floor role gets a company mobile. |
| **Google Drive** | Onboarding records | One folder per hire: `<Full Name> - Onboarding`, with `Signed Forms`, `Training Records`, `IT & Access` subfolders. |
| **Outlook** | Email | Used for staff email, such as welcome emails. |

## T21 access by role

| Role | T21 access |
|---|---|
| Estimator / assessor | Estimator profile |
| Panel beater / painter (shop floor) | Read-only / job-view profile |
| Admin / reception (invoicing, scheduling) | Admin profile |

## Not yet recorded

The source still has placeholders for these, so they're **unknown** here:
server name/IP, username convention, AD group names, exact T21 profile names,
Meraki dashboard org/network name, VPN type and server address, printer
name/IP/driver, and whether the shop has more than one site.

## Sources

- The `new-employee-it-setup` skill (`SKILL.md` and `references/network_systems.md`), set up by the user.
