// Cutover in-app guide. This is the only file to edit when the flow changes.
//
// Keeping it current:
//   - Add a line to whatsNew whenever a user-visible change ships, newest first.
//   - If a step names a screen element, list its id in refs. The test in
//     service/app/test/guide.test.mjs fails if that id no longer exists in index.html.
//   - who: "everyone" | "engineers" (platform engineers) | "admins" (workspace admins) | "operators".
//   - faq: questions the Ask button answers. step names the guide step to open.
//   - actions: {type:"link", label, href} | {type:"go", label, tab:"analyses"|"workspaces"|"guide"}
//              | {type:"repo-check", label}
window.CUTOVER_GUIDE = {
  updated: "2026-10-21",
  whatsNew: [
    "2026-10-21: A bell at the top right lists what changed for you: analysis progress, the next stage, the deeper assessment, plans, file purposes, privacy sign-offs, model keys, comments and action items.",
    "2026-10-21: Next steps has a scope choice. Choose the deeper assessment now. Modernize and Migrate unlock once it is complete.",
    "2026-10-21: A deeper assessment page describes the business, systems, data and workflows, with an architecture overview. It is also in the PDF report.",
    "2026-10-21: Planning and the file-level review show a status panel with the current stage.",
    "2026-10-21: The PDF report includes the accepted plans and the deeper assessment.",
    "2026-10-17: An Ask button answers how-to questions from this guide.",
    "2026-10-17: The guide and FAQ include sample addresses for sign-in, the install page and repository names.",
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
        "Sign in at https://app.cutover.site with your Google account.",
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
        "Example: to analyse https://github.com/ghlmaziz-gr8/voltcon, tick the voltcon repository under the ghlmaziz-gr8 account, at https://github.com/apps/cutover-reader-portal/installations/new.",
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
        "Enter the repository as owner/name: the two parts of its GitHub address after github.com. Cutover checks that it can read the default branch.",
        "Example: for https://github.com/ghlmaziz-gr8/voltcon, enter ghlmaziz-gr8/voltcon. Other examples: ghlmaziz-gr8/cutover, ghlmaziz-gr8/targetfit-studio.",
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
        "On the next steps screen you can choose the next stage, open the deeper assessment, download the report, which holds only what your role may see, invite a reviewer, or delete the results.",
        "Deleting removes the analysis, its comments and its action items. This cannot be undone.",
      ],
      actions: [],
      refs: ["downloadBtn", "deleteBtn", "scopeCard", "deeperCardNext"],
    },
    {
      id: "bell",
      title: "Follow updates with the bell",
      who: "everyone",
      body: [
        "The bell at the top right counts your unread updates. Open it to see them, coloured by kind: green for success, blue for information, amber for a warning, red for a problem, and purple for AI work.",
        "Updates cover analysis progress, the next stage, the deeper assessment, plans, file purposes, privacy sign-offs, model keys, comments and action items. Mark all read clears the count.",
      ],
      actions: [],
      refs: ["bellBtn", "notifPanel"],
    },
    {
      id: "scope",
      title: "Choose the next stage",
      who: "engineers",
      body: [
        "On What next, choose the next stage for the analysis: the deeper assessment, Modernize, or Migrate.",
        "Modernize and Migrate stay locked until the deeper assessment is complete. Pressing a locked option shows why. Choosing a stage tells the owner and the other platform engineers.",
      ],
      actions: [],
      refs: ["scopeCard", "scopeOpts"],
    },
    {
      id: "deeper",
      title: "Read the deeper assessment",
      who: "everyone",
      body: [
        "Open the deeper assessment from What next once the analysis has finished with its documents. It describes the business, the systems and delivery, the data, and the screens and actions, with an architecture overview.",
        "Each point names the finding it came from. You see only the points your role may see. The same content is in the PDF report.",
      ],
      actions: [],
      refs: ["deeperOpen", "deeperArch"],
    },
    {
      id: "plan",
      title: "Plan the risks and fallbacks",
      who: "engineers",
      body: [
        "Planning has three stages: draft the risks, review each proposal, then export. Accept, edit or reject each proposal. Nothing is final until a platform engineer accepts it.",
        "The status panel shows the stage and how many plans are decided. Accepted plans go into the PDF report. Rejected plans are left out.",
      ],
      actions: [],
      refs: ["phHud", "planDraft"],
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
  faq: [
    { q: "How do I add my GitHub repository?", step: "install",
      a: "Install the Cutover reader on it. Open https://github.com/apps/cutover-reader-portal/installations/new, choose 'Only select repositories', tick the repository, and Save. Then check it with the Check a repository step in the guide." },
    { q: "Cutover says it cannot read my repository. Why?", step: "check",
      a: "The Cutover reader is not installed on that repository, or the name is wrong. Enter the owner/name from the GitHub address: https://github.com/ghlmaziz-gr8/voltcon is entered as ghlmaziz-gr8/voltcon. Install the reader on the repository, then check again." },
    { q: "How do I start an analysis?", step: "start",
      a: "Sign in at https://app.cutover.site, open the Analyses tab, choose Start a new assessment, follow the steps, and confirm the data rule: sample or public code only, with no patient data. For example, the repository ghlmaziz-gr8/voltcon." },
    { q: "Why can't I see some findings?", step: "findings",
      a: "Findings are shared by role. Anything marked 'Not shown for your role' belongs to another role in the workspace." },
    { q: "How do I invite someone?", step: "invite",
      a: "On the Workspaces tab, enter their Google work email, choose a role, and select Invite. They sign in at https://app.cutover.site with that exact email." },
    { q: "Who can see my analysis?", step: "roles",
      a: "Only people invited to the same workspace, and only the findings their role allows." },
    { q: "How long are results kept?", step: "next",
      a: "Results are deleted after 30 days. You can delete them sooner from the next steps screen." },
    { q: "Is my source code stored?", step: "what",
      a: "No. Cutover reads the code and keeps only the findings and status." },
    { q: "How do I add action items or comments?", step: "discuss",
      a: "Open an analysis and use Add action item or Post comment at the bottom of the review. Auditors can comment, but cannot add or close action items." },
    { q: "What is the bell at the top right?", step: "bell",
      a: "It counts your unread updates. Open it to see analysis progress, the next stage, the deeper assessment, plans, file purposes, privacy sign-offs, model keys, comments and action items. Mark all read clears the count." },
    { q: "How do I choose the next stage?", step: "scope",
      a: "Open the analysis, go to What next, and under Choose the scope press Choose deeper assessment. Only platform engineers can choose, and the owner and other engineers are told." },
    { q: "Why are Modernize and Migrate locked?", step: "scope",
      a: "They unlock once the deeper assessment is complete. Until then the card shows the reason, and choosing them is refused." },
    { q: "Where is the deeper assessment?", step: "deeper",
      a: "Open What next and press Open the deeper assessment. It appears once the analysis has finished with its documents. An analysis started before this update does not have it, so start a new analysis." },
    { q: "How do I export the risk plan?", step: "plan",
      a: "The accepted plans are in the PDF report. Press Back to findings, then Export PDF, then choose Save as PDF in the print window. Rejected plans are left out." },
    { q: "What do the stages on planning mean?", step: "plan",
      a: "Draft means no risks are recorded yet. Engineer review means some plans still wait for a decision. Ready for the export means every plan is decided." },
    { q: "How do I create a customer workspace?", step: "customer",
      a: "Operators use Create a customer workspace on the Workspaces tab. You cannot see a customer's data unless you are invited into that workspace." },
  ],
};
