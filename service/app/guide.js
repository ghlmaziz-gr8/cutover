// Cutover in-app guide. This is the only file to edit when the flow changes.
//
// Keeping it current:
//   - Add a line to whatsNew whenever a user-visible change ships, newest first.
//   - If a step names a screen element, list its id in refs. The test in
//     service/app/test/guide.test.mjs fails if that id no longer exists in index.html.
//   - who: "everyone" | "engineers" (platform engineers) | "admins" (workspace admins) | "operators".
//   - actions: {type:"link", label, href} | {type:"go", label, tab:"analyses"|"workspaces"|"guide"}
//              | {type:"repo-check", label}
window.CUTOVER_GUIDE = {
  updated: "2026-10-17",
  whatsNew: [
    "2026-10-17: Home has tabs for Analyses, Workspaces and this guide.",
    "2026-10-17: Review shows charts and a summary, and healthcare results appear only when relevant.",
    "2026-10-17: Stages tick on one at a time when an analysis finishes.",
  ],
  steps: [
    {
      id: "what",
      title: "What Cutover does",
      who: "everyone",
      body: [
        "Cutover reads an application's code and reports what it is built on, where its data lives, and what needs a person's review.",
        "Cutover does not store source code. Only findings and status are kept, and results are deleted after 30 days.",
      ],
      actions: [],
      refs: [],
    },
    {
      id: "roles",
      title: "Roles and what each person sees",
      who: "everyone",
      body: [
        "Platform engineers start analyses. Security officers see security and privacy findings. Informatics leads see data and healthcare standards. CIOs and CTOs see the stack, screens, containers, delivery and infrastructure.",
        "Auditors see the summary and can comment, but not finding details. Anything you cannot see is marked 'Not shown for your role'.",
      ],
      actions: [],
      refs: [],
    },
    {
      id: "install",
      title: "Give Cutover access to a repository",
      who: "engineers",
      body: [
        "Cutover reads repositories through the Cutover reader GitHub app. Install it on each repository you want to analyse, including public ones.",
        "On the install page, choose 'Only select repositories', tick the ones you need, then Save. Do not use Suspend or Uninstall in the danger zone: they block all access.",
      ],
      actions: [
        { type: "link", label: "Open the install page", href: "https://github.com/apps/cutover-reader-portal/installations/new" },
      ],
      refs: [],
    },
    {
      id: "check",
      title: "Check that Cutover can read a repository",
      who: "engineers",
      body: [
        "Enter the repository as owner/name. Cutover checks that it can read the default branch.",
        "If the check says it cannot read the repository, the repository was not selected in the install step.",
      ],
      actions: [{ type: "repo-check", label: "Check a repository" }],
      refs: [],
    },
    {
      id: "start",
      title: "Start an analysis",
      who: "engineers",
      body: [
        "Choose Start a new assessment, name the application, enter its repository, and confirm the data rule: sample or public code only, with no patient data.",
        "The analysis takes a few minutes. The page updates by itself, and you can leave and come back.",
      ],
      actions: [{ type: "go", label: "Go to Analyses", tab: "analyses" }],
      refs: ["startNew"],
    },
    {
      id: "findings",
      title: "Read the findings",
      who: "everyone",
      body: [
        "The summary and charts count only the findings you can see. Cards group findings by area, and each can be expanded.",
        "'Inferred' means a reviewer should confirm the finding. 'Verified in code' means it was found directly in a file.",
      ],
      actions: [],
      refs: ["reviewBody"],
    },
    {
      id: "discuss",
      title: "Discuss and track work",
      who: "everyone",
      body: [
        "Leave comments for the team on any analysis in your workspace.",
        "Action items can be added and closed by anyone except auditors.",
      ],
      actions: [],
      refs: ["commentBtn", "actionBtn"],
    },
    {
      id: "next",
      title: "Decide what happens next",
      who: "everyone",
      body: [
        "On the next steps screen you can download the report, which holds only what your role may see, invite a reviewer, or delete the results.",
        "Deleting removes the analysis, its comments and its action items. This cannot be undone.",
      ],
      actions: [],
      refs: ["downloadBtn", "deleteBtn"],
    },
    {
      id: "invite",
      title: "Invite people to a workspace",
      who: "admins",
      body: [
        "Enter the person's work email exactly as they sign in with Google, choose their role, and tick 'Also a workspace admin' only if they should manage people.",
        "They see only this workspace.",
      ],
      actions: [{ type: "go", label: "Go to Workspaces", tab: "workspaces" }],
      refs: ["inviteEmail", "inviteBtn"],
    },
    {
      id: "customer",
      title: "Create a customer workspace",
      who: "operators",
      body: [
        "This creates a separate workspace for one customer and invites its first admin.",
        "You cannot see a customer's data unless you are invited into that workspace.",
      ],
      actions: [{ type: "go", label: "Go to Workspaces", tab: "workspaces" }],
      refs: ["opName", "opBtn"],
    },
  ],
};
