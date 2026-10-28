// The language model providers a workspace can connect. This is the only place a provider is listed.
//
// protocol: "anthropic" and "google" have their own request shapes. "openai" is the chat-completions
//   shape that most providers now accept, so a provider that speaks it needs only an entry here.
// baseUrl: the API address for "openai" providers. Its requests go to baseUrl + /chat/completions.
// tokenField: the name the provider uses for the output limit (OpenAI's newer models want max_completion_tokens).
// defaultModel: prefilled in the form. null means the person must type a model name.
// quest: the story shown when a person connects the provider: a title, a prologue, the chapters and an epilogue.
//   Each link is https and names the provider's own page.
//
// To add a provider that speaks the chat-completions shape, add one entry. A provider with a new shape needs code
// in the Worker (testModelKey) and in the analysis runner (engine/model_purposes.py).
// Checked 2026-10-21 against each provider's own documentation.

// notes (optional) add a sentence to the gate, the model or the vault chapter for that provider.
const OPENAI_QUEST = (name, keyPage, keyPageLabel, notes = {}) => ({
  title: `The ${name} Key`,
  prologue: `Every model needs a key. Forge one at ${name}, guard it, and bring it back here.`,
  epilogue: "Quest complete. Paste your key in the box below.",
  chapters: [
    { icon: "⚑", name: "The gate", text: `Open the ${name} key page and sign in to the account that should own the key.${notes.gate ? ` ${notes.gate}` : ""}`, url: keyPage, cta: keyPageLabel },
    { icon: "✦", name: "The forging", text: "Create a new API key and copy it straight away. Most providers show the whole key only once.", url: keyPage, cta: keyPageLabel },
    { icon: "❖", name: "The model", text: `${notes.model || "Check the model name in the box below."} Cutover checks the key and the model together with one tiny request.` },
    { icon: "◈", name: "The vault", text: `Paste the whole key in the box below. Treat it like a password: never share it or paste it into chat or email. Cutover tests it before saving and shows only its last four characters.${notes.vault ? ` ${notes.vault}` : ""}` },
  ],
});

const CUSTOM_QUEST = {
  title: "Your Own Model",
  prologue: "Any provider with a chat API in the OpenAI shape can serve as a model. Bring its address, its key and its model name.",
  epilogue: "Quest complete. Paste your key in the box below.",
  chapters: [
    { icon: "⚑", name: "The gate", text: "Get an API key from the provider you want to use. It must offer a chat API that follows the OpenAI chat-completions shape." },
    { icon: "❖", name: "The address", text: "Find the provider's API address. It starts with https:// and is the part before /chat/completions. Cutover adds /chat/completions to it. Examples: Gemini https://generativelanguage.googleapis.com/v1beta/openai, Groq https://api.groq.com/openai/v1, OpenRouter https://openrouter.ai/api/v1. Use the OpenAI-compatible address, not the provider's native one." },
    { icon: "✦", name: "The model", text: "Copy the exact model name the provider gives you for the model you want, and type it in the box below. A name is the model's own name, such as gpt-oss-120b or gemini-3.5-flash. The name you give a key on the provider's page is only a label." },
    { icon: "◈", name: "The vault", text: "Paste the whole key in the box below. Only send code to a provider you trust. Cutover tests the address, the key and the model before saving." },
  ],
};

export const MODEL_PROVIDERS = {
  anthropic: {
    name: "Anthropic", label: "Anthropic (Claude)", protocol: "anthropic",
    keyPage: "https://platform.claude.com/settings/keys", keyPageLabel: "Open the API keys page",
    defaultModel: "claude-haiku-5-5",
    quest: {
      title: "The Claude Key",
      prologue: "Every model needs a key. Forge one in the Claude Console, guard it, and bring it back here.",
      epilogue: "Quest complete. Paste your key in the box below.",
      chapters: [
        { icon: "⚑", name: "The gate", text: "Sign in to the Claude Console, or create an account if you don't have one.", url: "https://platform.claude.com/", cta: "Open the Claude Console" },
        { icon: "❖", name: "The ledger", text: "Open the API keys page in the Console.", url: "https://platform.claude.com/settings/keys", cta: "Open the API keys page" },
        { icon: "✦", name: "The forging", text: "Press Create key, give it a name, and choose an expiry. Set Linked account to yourself for your own use, or to a service account for shared use." },
        { icon: "◈", name: "The vault", text: "The full key starts with sk-ant- and is shown only once. Copy it and paste it in the box below. If you lose it, create a new key. Cutover tests it before saving and shows only its last four characters." },
      ],
    },
  },
  google: {
    name: "Google", label: "Google (Gemini)", protocol: "google",
    keyPage: "https://aistudio.google.com/apikey", keyPageLabel: "Open AI Studio",
    defaultModel: "gemini-3.5-flash",
    quest: {
      title: "The Gemini Key",
      prologue: "Every model needs a key. Forge one in Google AI Studio, guard it, and bring it back here.",
      epilogue: "Quest complete. Paste your key in the box below.",
      chapters: [
        { icon: "⚑", name: "The gate", text: "Open Google AI Studio and sign in with the Google account that should own the key.", url: "https://aistudio.google.com/apikey", cta: "Open AI Studio" },
        { icon: "❖", name: "The project", text: "New accounts get a project when they accept the terms. If you already use Google Cloud, open Dashboard, choose Projects, then Import projects, and pick the one you want." },
        { icon: "✦", name: "The forging", text: "On the API Keys page, press Create API key. Create it in the same project as your billing account, or it will be refused for billing. A listed provider is saved once, so for a second Gemini key choose Your own provider with the address https://generativelanguage.googleapis.com/v1beta/openai.", url: "https://aistudio.google.com/apikey", cta: "Go to the API Keys page" },
        { icon: "◈", name: "The vault", text: "Copy the key now. Treat it like a password: never share it or paste it into chat or email. Paste it in the box below. Cutover tests it before saving and shows only its last four characters." },
      ],
    },
  },
  openai: {
    name: "OpenAI", label: "OpenAI (ChatGPT)", protocol: "openai",
    baseUrl: "https://api.openai.com/v1", tokenField: "max_completion_tokens",
    keyPage: "https://platform.openai.com/api-keys", keyPageLabel: "Open the API keys page",
    defaultModel: "gpt-6-astra",
    quest: OPENAI_QUEST("OpenAI", "https://platform.openai.com/api-keys", "Open the API keys page"),
  },
  mistral: {
    name: "Mistral", label: "Mistral AI", protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyPage: "https://console.mistral.ai", keyPageLabel: "Open the Mistral console",
    defaultModel: "mistral-large-latest",
    quest: OPENAI_QUEST("Mistral", "https://console.mistral.ai", "Open the Mistral console", {
      gate: "The Experiment plan is free but needs a verified phone number. Mistral may use requests from it to train its models, so do not use it for client code.",
    }),
  },
  xai: {
    name: "xAI", label: "xAI (Grok)", protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyPage: "https://console.x.ai/team/default/api-keys", keyPageLabel: "Open the xAI console",
    defaultModel: "grok-4.7",
    quest: OPENAI_QUEST("xAI", "https://console.x.ai/team/default/api-keys", "Open the xAI console"),
  },
  deepseek: {
    name: "DeepSeek", label: "DeepSeek", protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    keyPage: "https://platform.deepseek.com/api_keys", keyPageLabel: "Open the DeepSeek key page",
    defaultModel: "deepseek-v4-pro",
    quest: OPENAI_QUEST("DeepSeek", "https://platform.deepseek.com/api_keys", "Open the DeepSeek key page"),
  },
  groq: {
    name: "Groq", label: "Groq", protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyPage: "https://console.groq.com/keys", keyPageLabel: "Open the Groq keys page",
    defaultModel: null,
    quest: OPENAI_QUEST("Groq", "https://console.groq.com/keys", "Open the Groq keys page", {
      model: "Type the model name exactly as Groq lists it, with the slash, for example openai/gpt-oss-120b. Groq's console lists its free models.",
    }),
  },
  openrouter: {
    name: "OpenRouter", label: "OpenRouter (many models)", protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPage: "https://openrouter.ai/keys", keyPageLabel: "Open the OpenRouter keys page",
    defaultModel: null,
    quest: OPENAI_QUEST("OpenRouter", "https://openrouter.ai/keys", "Open the OpenRouter keys page", {
      model: "Type the model name exactly as OpenRouter lists it. Free models end in :free, for example openai/gpt-oss-120b:free. Free models can be changed or removed, so check the name on OpenRouter's models page.",
      vault: "If the test reports HTTP 402, add a small balance, about $5, on OpenRouter before free models will answer.",
    }),
  },
  together: {
    name: "Together", label: "Together AI", protocol: "openai",
    baseUrl: "https://api.together.ai/v1",
    keyPage: "https://api.together.ai/settings/projects/~current/api-keys", keyPageLabel: "Open the Together key page",
    defaultModel: "MiniMaxAI/MiniMax-M3",
    quest: OPENAI_QUEST("Together AI", "https://api.together.ai/settings/projects/~current/api-keys", "Open the Together key page"),
  },
  custom: {
    name: "Custom", label: "Your own provider (OpenAI-compatible)", protocol: "openai", custom: true,
    keyPage: null, keyPageLabel: null,
    defaultModel: null,
    quest: CUSTOM_QUEST,
  },
};

// A model name as providers write them: letters, digits and . _ - / : (for example MiniMaxAI/MiniMax-M3).
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9._/:-]{1,120}$/;

// A custom address must be https, with a real host name (not an IP address, localhost or a login).
export function customBaseUrl(text) {
  if (typeof text !== "string" || text.length > 200) return null;
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname;
  const looksReal = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !/^\d+(\.\d+){3}$/.test(host) && host !== "localhost";
  if (url.protocol !== "https:" || !looksReal || url.username || url.password || url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}
