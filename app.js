const STORAGE_KEY = "small-goals-v1";
const RESET_BACKUP_KEY = "small-goals-reset-backup-v1";

const riskWords = [
  "股票",
  "基金",
  "期货",
  "比特币",
  "炒币",
  "杠杆",
  "借钱",
  "贷款",
  "辞职",
  "加盟",
  "囤货",
  "博彩",
  "赌博",
  "梭哈",
  "保证赚钱",
  "稳赚",
  "翻倍",
];

const projectTypes = ["内容/IP", "接单服务", "咨询", "电商", "私域", "实体小生意", "其他"];
const projectStatuses = ["验证中", "增长中", "暂缓", "已结束"];
const projectStages = ["想法", "验证", "成交", "增长", "暂停"];
const USD_TO_CNY = 7.2;
const startTemplates = {
  side: {
    label: "副业变现",
    projects: [
      ["小红书接广", "内容/IP"],
      ["咨询服务", "咨询"],
      ["私域成交", "私域"],
    ],
  },
  freelance: {
    label: "自由职业",
    projects: [
      ["客户线索", "接单服务"],
      ["交付项目", "接单服务"],
      ["老客户复购", "咨询"],
    ],
  },
  business: {
    label: "小生意经营",
    projects: [
      ["门店收入", "实体小生意"],
      ["线上获客", "私域"],
      ["成本控制", "实体小生意"],
    ],
  },
  career: {
    label: "求职/成长",
    projects: [
      ["AI应用产品经理求职", "其他"],
      ["作品集项目", "其他"],
      ["面试跟进", "其他"],
    ],
  },
  blank: {
    label: "空白开始",
    projects: [["第一个赚钱项目", "其他"]],
  },
};
const config = window.YGXMB_CONFIG || {};
const salesContact = {
  wechat: config.SALES_WECHAT || "请配置运营微信号",
  paymentHint: config.PAYMENT_HINT || "微信/支付宝转账均可，付款后发送截图和个人资料。",
  paymentQrSrc: config.PAYMENT_QR_SRC || "./assets/alipay-qr.jpg",
};
const cloud = {
  configured: Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase),
  client: null,
  session: null,
  checked: false,
  syncing: false,
  error: "",
  saveTimer: null,
};

const defaultState = {
  hasOnboarded: false,
  activeTab: "home",
  activeProjectId: null,
  editProjectId: null,
  editRecordId: null,
  modal: null,
  draftRecords: [],
  recordInputText: "",
  recordProjectId: "",
  recordNotice: "",
  lastCoachResponse: null,
  desktopMode: false,
  isPro: false,
  personalProfile: {
    rawText: "",
    role: "",
    incomePressure: "",
    weeklyHours: 8,
    skills: "",
    resources: "",
    earningPreference: "副业变现",
    riskPreference: "稳健",
    salesComfort: "可以尝试",
    aiTools: "",
    recommendations: [],
    projectDrafts: [],
  },
  goal: {
    name: "第一个 100 万",
    targetAmount: 100000,
    initialAmount: 0,
    deadline: "2026-12-31",
    weeklyHours: 8,
    riskPreference: "稳健",
  },
  projects: [],
  records: [],
  dailyAction: {
    text: "记录今天的一笔收入、支出或行动",
    projectName: "",
    estimatedMinutes: 10,
    status: "pending",
  },
};

let state = loadState();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function seedRecords(projects) {
  const xhs = projects[0].id;
  const consult = projects[1].id;
  const video = projects[2].id;
  return [
    record("income", 800, xhs, "接广收入", -1, true),
    record("income", 1200, xhs, "品牌合作尾款", -3, true),
    record("expense", 200, xhs, "样品与拍摄道具", -2, false),
    record("income", 680, consult, "老客户咨询", -4, true),
    record("expense", 120, video, "投流测试", -2, false),
    record("income", 40, video, "小额分成", -1, true),
    { ...record("action", 0, consult, "联系了 5 个潜在客户", -1, false), actionCount: 5, actionUnit: "人" },
  ];
}

function record(type, amount, projectId, note, daysOffset, included) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return {
    id: uid(),
    recordType: type,
    amount,
    projectId,
    note,
    sourceText: note,
    occurredAt: date.toISOString().slice(0, 10),
    includedInGoal: included,
    aiConfidence: 0.86,
    createdAt: new Date().toISOString(),
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(saved), activeTab: "home", modal: null, draftRecords: [], editRecordId: null };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, modal: null, draftRecords: [], editRecordId: null }));
  queueCloudSave();
}

function snapshotState() {
  return {
    hasOnboarded: state.hasOnboarded,
    isPro: state.isPro,
    personalProfile: state.personalProfile,
    goal: state.goal,
    projects: state.projects,
    records: state.records,
    dailyAction: state.dailyAction,
  };
}

function applySnapshot(data) {
  if (!data || typeof data !== "object") return;
  state = {
    ...state,
    ...data,
    activeTab: "home",
    activeProjectId: null,
    editProjectId: null,
    editRecordId: null,
    modal: null,
    draftRecords: [],
    desktopMode: false,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, modal: null, draftRecords: [], editRecordId: null }));
}

async function initCloud() {
  if (!cloud.configured) {
    cloud.checked = true;
    render();
    return;
  }
  try {
    cloud.client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    const { data } = await cloud.client.auth.getSession();
    cloud.session = data.session;
    cloud.checked = true;
    if (cloud.session) await loadCloudState();
  } catch (error) {
    cloud.error = `云端连接失败：${error.message}`;
    cloud.checked = true;
  }
  render();
}

async function loadCloudState() {
  if (!cloud.client || !cloud.session) return;
  cloud.syncing = true;
  render();
  const { data, error } = await cloud.client
    .from("app_states")
    .select("data")
    .eq("user_id", cloud.session.user.id)
    .maybeSingle();
  if (error) {
    cloud.error = `读取云端数据失败：${error.message}`;
  } else if (data?.data && Object.keys(data.data).length) {
    applySnapshot(data.data);
  } else {
    await uploadCloudState();
  }
  cloud.syncing = false;
}

function queueCloudSave() {
  if (!cloud.configured || !cloud.session || !cloud.client) return;
  clearTimeout(cloud.saveTimer);
  cloud.saveTimer = setTimeout(() => {
    uploadCloudState();
  }, 500);
}

async function uploadCloudState() {
  if (!cloud.configured || !cloud.session || !cloud.client) return;
  cloud.syncing = true;
  const payload = {
    user_id: cloud.session.user.id,
    data: snapshotState(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await cloud.client.from("app_states").upsert(payload, { onConflict: "user_id" });
  if (error) cloud.error = `同步失败：${error.message}`;
  cloud.syncing = false;
}

function money(value) {
  return `¥${Math.round(value || 0).toLocaleString("zh-CN")}`;
}

function percent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(999, value)).toFixed(value < 10 ? 1 : 0)}%`;
}

function getProject(id) {
  return state.projects.find((project) => project.id === id);
}

function getStats() {
  const goalIncome = state.records
    .filter((item) => item.recordType === "income" && item.includedInGoal)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const completed = Number(state.goal.initialAmount || 0) + goalIncome;
  const remaining = Math.max(0, Number(state.goal.targetAmount || 0) - completed);
  const progress = Number(state.goal.targetAmount || 0) ? (completed / Number(state.goal.targetAmount)) * 100 : 0;

  const weekRecords = getWeekRecords();
  const weekIncome = sumByType(weekRecords, "income");
  const weekExpense = sumByType(weekRecords, "expense");
  const weekNet = weekIncome - weekExpense;

  const projectStats = state.projects
    .map((project) => {
      const records = state.records.filter((item) => item.projectId === project.id);
      const week = weekRecords.filter((item) => item.projectId === project.id);
      const income = sumByType(records, "income");
      const expense = sumByType(records, "expense");
      const weekIncome = sumByType(week, "income");
      const weekExpense = sumByType(week, "expense");
      return {
        ...project,
        income,
        expense,
        net: income - expense,
        weekIncome,
        weekExpense,
        weekNet: weekIncome - weekExpense,
        actions: records.filter((item) => item.recordType === "action").length,
      };
    })
    .sort((a, b) => b.weekNet - a.weekNet);

  return {
    completed,
    remaining,
    progress,
    weekIncome,
    weekExpense,
    weekNet,
    projectStats,
    bestProject: projectStats[0],
  };
}

function getWeekRecords() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return state.records.filter((item) => new Date(item.occurredAt) >= start);
}

function sumByType(records, type) {
  return records.filter((item) => item.recordType === type).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function render() {
  const app = document.querySelector("#app");
  if (!app) return;
  if (cloud.configured && !cloud.checked) {
    app.innerHTML = renderLoadingPage("正在连接云端数据...");
    return;
  }
  if (cloud.configured && !cloud.session) {
    app.innerHTML = renderAuthPage();
    bindEvents();
    return;
  }
  if (!state.hasOnboarded) {
    app.innerHTML = renderOnboarding();
    bindEvents();
    return;
  }

  if (state.desktopMode) {
    app.innerHTML = renderDesktopMode();
    bindEvents();
    return;
  }

  app.innerHTML = `
    <main class="app-shell">
      ${renderCurrentPage()}
    </main>
    ${renderBottomNav()}
    ${renderModal()}
  `;
  bindEvents();
}

function renderCurrentPage() {
  if (state.activeTab === "record") return renderRecordPage();
  if (state.activeTab === "projects") return renderProjectsPage();
  if (state.activeTab === "review") return renderReviewPage();
  if (state.activeTab === "me") return renderMePage();
  return renderHomePage();
}

function renderLoadingPage(text) {
  return `
    <main class="onboarding">
      <section class="card">
        <div class="brand">亿</div>
        <div class="eyebrow">AI 赚钱目标作战台</div>
        <h1 class="title">${text}</h1>
        <p class="hero-sub">正在准备你的个人数据空间。</p>
      </section>
    </main>
  `;
}

function renderAuthPage() {
  return `
    <main class="onboarding">
      <section class="card">
        <div class="brand">亿</div>
        <div class="eyebrow">云端内测版</div>
        <h1 class="title">登录你的赚钱作战台</h1>
        <p class="hero-sub">登录后，你的目标、项目和记录会保存到云端。别人注册后也会拥有自己的独立数据。</p>
        ${cloud.error ? `<div class="notice auth-error">${cloud.error}</div>` : ""}
        <div class="form section">
          <div class="field">
            <label>邮箱</label>
            <input id="authEmail" type="email" placeholder="you@example.com" />
          </div>
          <div class="field">
            <label>密码</label>
            <input id="authPassword" type="password" placeholder="至少 6 位" />
          </div>
          <button class="primary-btn" data-action="auth-login">登录</button>
          <button class="secondary-btn" data-action="auth-signup">注册并开始</button>
          <div class="notice">AI 内容仅供记录和复盘参考，不承诺任何收入结果。</div>
        </div>
      </section>
    </main>
  `;
}

function renderTopbar(title, eyebrow = "亿个小目标") {
  const syncText = cloud.configured
    ? cloud.session
      ? cloud.syncing
        ? "云端同步中"
        : "云端已开启"
      : "未登录"
    : "本地模式";
  return `
    <div class="topbar">
      <div>
        <div class="eyebrow">${eyebrow} · ${syncText}</div>
        <h1 class="title">${title}</h1>
      </div>
      <button class="icon-btn" data-open="goal" aria-label="设置目标">⚙</button>
    </div>
  `;
}

function renderHomePage() {
  const stats = getStats();
  const monthNeed = getMonthlyNeed(stats.remaining);
  const coachInsight = buildAICoachInsight();
  return `
    ${renderTopbar("今天继续盯住目标")}

    <section class="card hero-card">
      <div class="hero-label">距离你的 ${shortAmount(state.goal.targetAmount)} 目标，还差</div>
      <div class="hero-number">${money(stats.remaining)}</div>
      <div class="hero-sub">已完成 ${money(stats.completed)} / ${money(state.goal.targetAmount)} · 截止 ${state.goal.deadline}</div>
      <div class="progress"><div class="progress-bar" style="width:${Math.min(100, stats.progress)}%"></div></div>
      <div class="hero-sub">${progressCopy(stats.progress)} 本月建议盯住 ${money(monthNeed)} 的收入进展。</div>
      <div class="stats-row">
        <div class="mini-stat"><span>完成度</span><strong>${percent(stats.progress)}</strong></div>
        <div class="mini-stat"><span>本周净收益</span><strong>${money(stats.weekNet)}</strong></div>
        <div class="mini-stat"><span>最佳项目</span><strong>${stats.bestProject?.name || "暂无"}</strong></div>
      </div>
      <div class="button-row">
        <button class="secondary-btn" data-action="desktop-mode">桌面屏模式</button>
      </div>
    </section>

    <section class="section card action-card">
      <span class="pill orange">今日行动</span>
      <div class="action-text">${state.dailyAction.text}</div>
      <div class="hero-sub">预计 ${state.dailyAction.estimatedMinutes} 分钟 · ${state.dailyAction.projectName || "未关联项目"}</div>
      <div class="ai-reason-box">
        <strong>AI 今日判断</strong>
        <p>${coachInsight.todayJudgment}</p>
        <span>${coachInsight.reason}</span>
      </div>
      <div class="button-row">
        <button class="primary-btn" data-action="complete-action">${state.dailyAction.status === "completed" ? "已完成" : "完成"}</button>
        <button class="secondary-btn" data-action="refresh-action">换一个</button>
      </div>
    </section>

    ${
      state.lastCoachResponse
        ? `<section class="section card ai-response-card">
            <span class="pill blue">${state.lastCoachResponse.title}</span>
            <div class="action-text">${state.lastCoachResponse.summary}</div>
            <div class="hero-sub">${state.lastCoachResponse.nextAction}</div>
            <div class="notice">关联项目：${state.lastCoachResponse.projectName || "未关联项目"}</div>
          </section>`
        : ""
    }

    <section class="section card quick-card">
      <div>
        <strong>今天发生了什么？</strong>
        <p>用一句话记录收入、支出或行动。</p>
      </div>
      <button data-tab="record">记一笔</button>
    </section>

    <div class="section-head">
      <h2 class="section-title">本周战况</h2>
      <button class="text-btn" data-tab="review">看复盘</button>
    </div>
    <section class="card">
      <div class="grid-3">
        <div class="metric"><span>收入</span><strong class="money positive">${money(stats.weekIncome)}</strong></div>
        <div class="metric"><span>支出</span><strong class="money negative">${money(stats.weekExpense)}</strong></div>
        <div class="metric"><span>净收益</span><strong>${money(stats.weekNet)}</strong></div>
      </div>
    </section>

    <div class="section-head">
      <h2 class="section-title">项目表现</h2>
      <button class="text-btn" data-tab="projects">全部</button>
    </div>
    <div class="project-list">
      ${stats.projectStats.slice(0, 3).map(renderProjectCard).join("") || `<div class="empty">先创建第一个赚钱项目。</div>`}
    </div>
  `;
}

function shortAmount(value) {
  if (value >= 10000) return `${Math.round(value / 10000)}万`;
  return money(value);
}

function progressCopy(progress) {
  if (state.records.length < 3) return "记录还不够多，先连续记录 7 天。";
  if (progress >= 60) return "当前进度基本健康，继续保持记录和复盘。";
  if (progress >= 20) return "当前进度需要持续观察。";
  return "当前进度略落后，建议优先推进已有成交线索。";
}

function getMonthlyNeed(remaining) {
  const deadline = new Date(state.goal.deadline);
  const now = new Date();
  const months = Math.max(1, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth());
  return remaining / months;
}

function getRecordExamples() {
  const project = getProject(state.recordProjectId) || getActionProject() || state.projects[0];
  const projectName = project?.name || "当前项目";
  if (project?.targetCustomer || project?.type === "实体小生意") {
    return [
      { label: "收入 800", text: `${projectName}收到客户付款800元` },
      { label: "支出 120", text: `${projectName}工具订阅支出120元` },
      { label: "跟进 3 个客户", text: `${projectName}跟进了3个潜在客户` },
    ];
  }
  if (project?.type === "其他" && project?.name?.includes("求职")) {
    return [
      { label: "投递 3 个岗位", text: `${projectName}投递了3个岗位` },
      { label: "支出 60", text: `${projectName}简历优化支出60元` },
      { label: "面试 1 次", text: `${projectName}完成1次面试沟通` },
    ];
  }
  return [
    { label: "收入 800", text: `${projectName}收入800元` },
    { label: "支出 120", text: `${projectName}支出120元` },
    { label: "联系 3 个客户", text: `${projectName}联系了3个潜在客户` },
  ];
}

function getOnboardingExamples() {
  return [
    {
      label: "AI产品/售前",
      text: "我有10多年B端产品经验，是产品经理，可以做业务系统、解决方案、售前和招投标。我现在学习AI，可以快速出图文、视频，也可以生成业务系统。每周能投入20小时，想在两年内做到百万目标。",
    },
    {
      label: "副业接单",
      text: "我现在做运营和内容，有小红书、抖音经验，会写文案、剪视频、做账号定位。每周能投入8小时，想先用AI帮小商家做内容获客和短视频，稳一点接单变现。",
    },
    {
      label: "小生意经营",
      text: "我有一些本地客户和老客户资源，熟悉销售、报价和客户沟通。每周能投入6小时，想低成本测试一个赚钱项目，不想先囤货，也不想承诺收益。",
    },
  ];
}

function renderRecordPage() {
  const records = [...state.records].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const examples = getRecordExamples();
  return `
    ${renderTopbar("记录进展", "10 秒记一笔")}
    <section class="card">
      <div class="form">
        <div class="field">
          <label>归属项目</label>
          <select id="recordProjectId">
            <option value="" ${!state.recordProjectId ? "selected" : ""}>未关联/个人事项</option>
            ${state.projects.map((project) => `<option value="${project.id}" ${project.id === state.recordProjectId ? "selected" : ""}>${project.name}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>今天发生了什么？</label>
          <textarea id="recordText" placeholder="例如：${examples[0].text}">${state.recordInputText || ""}</textarea>
        </div>
        <div class="chips">
          ${examples.map((item) => `<button class="chip" data-example="${item.text}">${item.label}</button>`).join("")}
        </div>
        <div class="button-row">
          <button class="secondary-btn" data-action="voice-input">使用系统语音输入</button>
          <button class="primary-btn" data-action="parse-record">AI 识别</button>
        </div>
        ${state.recordNotice ? `<div class="notice auth-error">${state.recordNotice}</div>` : ""}
        <div class="notice">提示：先选归属项目更稳；没有明确项目时，会按这里选择的项目入账。</div>
      </div>
    </section>

    <div class="section-head">
      <h2 class="section-title">最近记录</h2>
    </div>
    <div class="record-list">
      ${records.map(renderRecordCard).join("") || `<div class="empty">还没有记录。先记下今天的一点进展。</div>`}
    </div>
  `;
}

function renderRecordCard(item) {
  const project = getProject(item.projectId);
  const typeText = item.recordType === "income" ? "收入" : item.recordType === "expense" ? "支出" : "行动";
  const amount = item.recordType === "action" ? `${item.actionCount || 1}${item.actionUnit || "次"}` : money(item.amount);
  const cls = item.recordType === "income" ? "positive" : item.recordType === "expense" ? "negative" : "";
  return `
    <article class="card record-card">
      <div>
        <div class="record-title">${typeText} · ${project?.name || "未关联项目"}</div>
        <div class="record-note">${item.note || "无备注"} · ${item.occurredAt}</div>
      </div>
      <div>
        <div class="money ${cls}">${amount}</div>
        <button class="text-btn" data-edit-record="${item.id}">编辑</button>
        <button class="text-btn" data-delete-record="${item.id}">删除</button>
      </div>
    </article>
  `;
}

function renderProjectsPage() {
  const stats = getStats().projectStats;
  if (state.activeProjectId) {
    const project = stats.find((item) => item.id === state.activeProjectId);
    return renderProjectDetail(project);
  }
  return `
    ${renderTopbar("赚钱项目", "哪个项目值得继续")}
    <div class="tabs">
      <button class="tab active">本周净收益</button>
      <button class="tab">累计净收益</button>
      <button class="tab">ROI</button>
    </div>
    <div class="project-list">
      ${stats.map(renderProjectCard).join("") || `<div class="empty">还没有项目。你可以先记录个人事项，或者新建第一个赚钱项目。</div>`}
    </div>
    <div class="section">
      <button class="primary-btn" data-action="new-project">新建项目</button>
    </div>
  `;
}

function renderProjectCard(project) {
  const roi = project.expense > 0 ? `${Math.round((project.net / project.expense) * 100)}%` : "暂无成本";
  return `
    <article class="card project-card" data-project="${project.id}">
      <div class="project-top">
        <div>
          <div class="project-name">${project.name}</div>
          <div class="project-meta">${project.type} · ${project.stage || project.status} ${project.targetCustomer ? `· ${project.targetCustomer}` : ""}</div>
        </div>
        <span class="pill ${project.weekNet >= 0 ? "green" : "orange"}">${project.weekNet >= 0 ? "净收益" : "需观察"}</span>
      </div>
      <div class="grid-3">
        <div class="metric"><span>本周</span><strong class="money ${project.weekNet >= 0 ? "positive" : "negative"}">${money(project.weekNet)}</strong></div>
        <div class="metric"><span>累计</span><strong>${money(project.net)}</strong></div>
        <div class="metric"><span>ROI</span><strong>${roi}</strong></div>
      </div>
    </article>
  `;
}

function renderProjectDetail(project) {
  if (!project) {
    state.activeProjectId = null;
    return renderProjectsPage();
  }
  const records = state.records.filter((item) => item.projectId === project.id);
  return `
    <div class="topbar">
      <div>
        <div class="eyebrow">${project.type} · ${project.status}</div>
        <h1 class="title">${project.name}</h1>
      </div>
      <button class="icon-btn" data-action="back-projects">←</button>
    </div>
    <section class="card">
      <div class="grid-3">
        <div class="metric"><span>本周收入</span><strong class="money positive">${money(project.weekIncome)}</strong></div>
        <div class="metric"><span>本周支出</span><strong class="money negative">${money(project.weekExpense)}</strong></div>
        <div class="metric"><span>本周净收益</span><strong>${money(project.weekNet)}</strong></div>
      </div>
      <div class="button-row">
        <button class="secondary-btn" data-edit-project="${project.id}">编辑项目</button>
        <button class="secondary-btn" data-tab="record">记一笔</button>
      </div>
    </section>
    <section class="section card">
      <span class="pill blue">项目画像</span>
      <div class="profile-list">
        <div><strong>目标客户</strong><span>${project.targetCustomer || "未填写"}</span></div>
        <div><strong>变现方式</strong><span>${project.monetization || "未填写"}</span></div>
        <div><strong>阶段</strong><span>${project.stage || project.status || "未填写"}</span></div>
        <div><strong>下一步</strong><span>${project.nextAction || "未填写"}</span></div>
        <div><strong>风险提醒</strong><span>${project.description || "先低成本验证，不承诺收益，不盲目加大投入。"}</span></div>
      </div>
    </section>
    <section class="section card">
      <span class="pill blue">AI 项目复盘</span>
      <p class="review-block">${projectInsight(project)}</p>
      <div class="notice">以下内容仅基于你记录的数据生成，供复盘参考。</div>
    </section>
    <div class="section-head"><h2 class="section-title">项目记录</h2></div>
    <div class="record-list">
      ${records.map(renderRecordCard).join("") || `<div class="empty">这个项目还没有记录。</div>`}
    </div>
  `;
}

function projectInsight(project) {
  if (project.weekNet > 1000) {
    return `这个项目本周净收益最高，但收入样本仍然有限。下周可以先联系 3 个相似客户，测试复购或转介绍机会。`;
  }
  if (project.weekNet < 0) {
    return `这个项目本周为负收益。建议先复盘支出来源和转化路径，暂停没有明确回报的新增成本。`;
  }
  return `这个项目还在验证期。建议继续做低成本动作，至少记录 7 天后再判断是否加大投入。`;
}

function renderReviewPage() {
  const review = buildReview();
  if (!state.isPro) return renderFreeReviewPage(review);
  return `
    ${renderTopbar("AI 周复盘", "看清下周重点")}
    <section class="card review">
      <div class="review-block">
        <h3>1. 本周发生了什么</h3>
        <p>${review.summary}</p>
      </div>
      <div class="review-block">
        <h3>2. 表现最好</h3>
        <p>${review.best}</p>
      </div>
      <div class="review-block">
        <h3>3. 需要警惕</h3>
        <p>${review.watch}</p>
      </div>
      <div class="review-block">
        <h3>4. 下周行动参考</h3>
        <ul>${review.actions.map((item, index) => `<li>${item.text} <button class="text-btn" data-set-action="${index}">设为今日行动</button></li>`).join("")}</ul>
      </div>
      <div class="notice">以上内容基于你记录的数据生成，仅供复盘参考，不构成收益承诺或投资建议。</div>
    </section>
    <section class="section card">
      <span class="pill green">Pro 已开启</span>
      <div class="action-text">继续记录 7 天，复盘会更准</div>
      <div class="hero-sub">样本越多，项目判断和行动参考越稳定。</div>
    </section>
  `;
}

function renderFreeReviewPage(review) {
  const stats = getStats();
  return `
    ${renderTopbar("AI 周复盘", "看清下周重点")}
    <section class="card review">
      <div class="review-block">
        <h3>本周简报</h3>
        <p>收入 ${money(stats.weekIncome)}，支出 ${money(stats.weekExpense)}，净收益 ${money(stats.weekNet)}。表现最好：${stats.bestProject?.name || "暂无"}。</p>
      </div>
      <div class="notice">免费版展示简报。完整复盘包含项目警惕、目标进度变化和下周行动参考。</div>
    </section>
    <section class="section card">
      <span class="pill orange">Pro 付费点</span>
      <div class="action-text">解锁完整 AI 周复盘</div>
      <div class="hero-sub">看清本周哪个项目最有效，下周该优先推进什么。</div>
      <div class="button-row">
        <button class="primary-btn" data-action="unlock-pro">内测开通 Pro</button>
      </div>
      <div class="notice">AI 复盘仅供参考，不承诺任何收入或商业结果。</div>
    </section>
  `;
}

function buildReview() {
  const stats = getStats();
  const best = stats.bestProject;
  const watch = [...stats.projectStats].sort((a, b) => a.weekNet - b.weekNet)[0];
  const profile = state.personalProfile || {};
  const summary = `本周你共记录 ${getWeekRecords().length} 次，收入 ${money(stats.weekIncome)}，支出 ${money(stats.weekExpense)}，净收益 ${money(stats.weekNet)}。`;
  const bestText = best
    ? `${best.name} 本周净收益 ${money(best.weekNet)}。${best.targetCustomer ? `目标客户是${best.targetCustomer}，` : ""}建议继续验证复购和转介绍。`
    : "记录还不够多，暂时无法判断最佳项目。";
  const watchText =
    watch && watch.weekNet < 0
      ? `${watch.name} 本周净收益为 ${money(watch.weekNet)}。建议先复盘成本来源，暂停无明确回报的新增投入。`
      : "暂时没有明显亏损项目，但样本量有限，继续记录一周会更准确。";
  const projectName = best?.name || state.projects[0]?.name || "当前项目";
  const suggestedProject = best || state.projects[0];
  const profileHint = profile.weeklyHours ? `按你每周可投入 ${profile.weeklyHours} 小时来安排，` : "";
  const customerHint = suggestedProject?.targetCustomer || "潜在客户";
  const firstAction = suggestedProject?.nextAction
    ? { text: `${profileHint}${suggestedProject.nextAction}。`, minutes: actionMinutes(25, profile), source: "项目下一步" }
    : { text: `${profileHint}围绕 ${projectName} 联系 3 个${customerHint}或相似品牌。`, minutes: actionMinutes(30, profile), source: "项目画像" };
  const secondAction =
    profile.salesComfort === "抗拒销售"
      ? { text: `整理 1 个最近的成交案例，先发给熟人或老客户，不做强推。`, minutes: actionMinutes(25, profile), source: "个人画像" }
      : { text: "整理 1 个最近的成交案例，发布成内容或发给客户。", minutes: actionMinutes(25, profile), source: "获客动作" };
  return {
    summary,
    best: bestText,
    watch: watchText,
    actions: [
      firstAction,
      secondAction,
      { text: "复盘本周支出，标记一项可以暂停的低效成本。", minutes: actionMinutes(20, profile), source: "成本控制" },
    ],
  };
}

function renderMePage() {
  const profile = state.personalProfile || {};
  const profileReady = Boolean(profile.role || profile.skills || profile.resources);
  const profileDisplay = buildProfileDisplay(profile, state.projects);
  const firstDaySummary = buildFirstDaySummary(profile, state.projects, state.dailyAction);
  const contentPack = buildContentStarterPack(profile, state.projects);
  const coachInsight = buildAICoachInsight();
  const paidReport = buildPaidDiagnosisReport();
  return `
    ${renderTopbar("我的", "设置与内测")}
    <section class="card">
      <span class="pill ${profileReady ? "green" : "orange"}">${profileReady ? "画像已建立" : "画像待补充"}</span>
      <div class="action-text">${profile.role || "补充个人画像，让 AI 更懂你"}</div>
      <div class="hero-sub">${profile.skills || "填写职业、技能、资源、时间和赚钱偏好，后续行动建议会更贴合你。"}</div>
      <div class="button-row">
        <button class="primary-btn" data-open="profile">${profileReady ? "编辑个人画像" : "建立个人画像"}</button>
        ${profileReady ? `<button class="secondary-btn" data-action="copy-profile-share">复制画像文案</button>` : ""}
      </div>
    </section>
    ${
      profileReady
        ? `<section class="section card first-day-card">
            <span class="pill green">首日结果</span>
            <div class="action-text">${firstDaySummary.positioning}</div>
            <div class="profile-summary-grid">
              <div><span>优先项目</span><strong>${firstDaySummary.firstProject}</strong></div>
              <div><span>今天行动</span><strong>${firstDaySummary.firstAction}</strong></div>
              <div><span>服务包</span><strong>${firstDaySummary.servicePackage}</strong></div>
              <div><span>第一批客户</span><strong>${firstDaySummary.firstCustomer}</strong></div>
            </div>
            <div class="quick-win-list">
              ${firstDaySummary.quickWins.map((item) => `<span>${item}</span>`).join("")}
            </div>
            <div class="button-row">
              <button class="primary-btn" data-action="copy-profile-share">复制画像文案</button>
              <button class="secondary-btn" data-tab="record">记录第一笔</button>
            </div>
          </section>
          <section class="section card paid-report-card">
            <div class="card-headline">
              <span class="pill orange">${paidReport.priceLabel}</span>
              <span>${paidReport.limitedOffer}</span>
            </div>
            <div class="action-text">${paidReport.title}</div>
            <div class="hero-sub">${paidReport.valuePromise}</div>
            <div class="offer-strip">
              <strong>${paidReport.summary}</strong>
              <span>付款后交付，不承诺收益，只交付诊断、计划和复核。</span>
            </div>
            <div class="paid-deliverables">
              ${paidReport.deliverables.map((item) => `<div>${item}</div>`).join("")}
            </div>
            <div class="purchase-box">
              <strong>${paidReport.payment.title}</strong>
              <div class="payment-qr-box">
                <img src="${paidReport.payment.qrSrc}" alt="支付宝收款码" />
                <div>
                  <span>${paidReport.payment.method}</span>
                  <p>扫码付款 ¥99，付款后截图，连同下单资料一起发送。</p>
                </div>
              </div>
              <ol>${paidReport.purchaseSteps.map((item) => `<li>${item}</li>`).join("")}</ol>
              <div class="notice">${paidReport.payment.copy}</div>
              <pre class="order-template">${paidReport.orderTemplate}</pre>
            </div>
            <div class="button-row">
              <button class="primary-btn" data-action="copy-purchase-guide">复制购买说明</button>
              <button class="secondary-btn" data-action="copy-order-template">复制下单资料</button>
            </div>
            <div class="notice">${paidReport.boundary}</div>
          </section>
          <section class="section card ai-diagnosis-card compact-section">
            <span class="pill blue">AI 诊断报告</span>
            <div class="action-text">${coachInsight.diagnosis.summary}</div>
            <div class="profile-summary-grid">
              <div><span>最强资产</span><strong>${coachInsight.diagnosis.strongestAsset}</strong></div>
              <div><span>最优路径</span><strong>${coachInsight.diagnosis.bestPath}</strong></div>
              <div><span>最大风险</span><strong>${coachInsight.diagnosis.risk}</strong></div>
              <div><span>7天重点</span><strong>${coachInsight.diagnosis.next7Days}</strong></div>
            </div>
            <div class="ai-question-list">
              ${coachInsight.followUpQuestions.map((item) => `<button class="ai-question" data-coach-question="${item}">${item}</button>`).join("")}
            </div>
            <div class="notice">${coachInsight.boundary}</div>
          </section>
          <section class="section card content-starter-card compact-section">
            <span class="pill blue">可直接发布</span>
            <div class="action-text">3 条内容选题 + 自我介绍</div>
            <div class="content-topic-list">
              ${contentPack.topics
                .map(
                  (item) => `
                    <article class="content-topic">
                      <strong>${item.title}</strong>
                      <p>${item.hook}</p>
                      <ol>${item.outline.map((step) => `<li>${step}</li>`).join("")}</ol>
                    </article>
                  `,
                )
                .join("")}
            </div>
            <div class="intro-box">${contentPack.intro}</div>
            <div class="button-row">
              <button class="primary-btn" data-action="copy-self-intro">复制自我介绍</button>
              <button class="secondary-btn" data-action="copy-content-pack">复制选题</button>
            </div>
          </section>
          <details class="section card profile-display">
            <summary>
              <span>
                <strong>完整 AI 画像</strong>
                <em>标签、服务包、客户和路线图</em>
              </span>
            </summary>
            <div class="profile-block">
              <strong>身份标签</strong>
              <div class="tag-cloud">${profileDisplay.identityTags.map((item) => `<span>${item}</span>`).join("")}</div>
            </div>
            <div class="profile-block">
              <strong>能力资产</strong>
              <div class="tag-cloud">${profileDisplay.assetTags.map((item) => `<span>${item}</span>`).join("")}</div>
            </div>
            <div class="profile-block">
              <strong>可变现方向</strong>
              <div class="profile-list compact">
                ${profileDisplay.monetizationTags.map((item) => `<div><span>${item}</span></div>`).join("")}
              </div>
            </div>
            <div class="profile-block">
              <strong>推荐服务包</strong>
              <div class="profile-list compact">
                ${profileDisplay.servicePackages.map((item) => `<div><span>${item}</span></div>`).join("")}
              </div>
            </div>
            <div class="profile-block">
              <strong>内容选题</strong>
              <div class="profile-list compact">
                ${profileDisplay.contentTopics.map((item) => `<div><span>${item}</span></div>`).join("")}
              </div>
            </div>
            <div class="profile-block">
              <strong>第一批客户</strong>
              <div class="profile-list compact">
                ${profileDisplay.firstCustomers.map((item) => `<div><span>${item}</span></div>`).join("")}
              </div>
            </div>
            <div class="profile-block">
              <strong>不建议做</strong>
              <div class="profile-list compact">
                ${profileDisplay.avoidList.map((item) => `<div><span>${item}</span></div>`).join("")}
              </div>
            </div>
            <div class="profile-block">
              <strong>两年百万路线图</strong>
              <ol class="roadmap-list">${profileDisplay.roadmap.map((item) => `<li>${item}</li>`).join("")}</ol>
            </div>
          </details>`
        : ""
    }
    <section class="section card">
      <span class="pill blue">AI 判断依据</span>
      <div class="profile-grid">
        <div class="metric"><span>可投入时间</span><strong>${profile.weeklyHours || state.goal.weeklyHours || 0} 小时/周</strong></div>
        <div class="metric"><span>赚钱偏好</span><strong>${profile.earningPreference || "未填写"}</strong></div>
        <div class="metric"><span>风险偏好</span><strong>${profile.riskPreference || state.goal.riskPreference || "未填写"}</strong></div>
      </div>
    </section>
    <section class="card">
      <span class="pill ${state.isPro ? "green" : "blue"}">${state.isPro ? "Pro 内测" : "免费内测"}</span>
      <div class="action-text">${state.isPro ? "完整 AI 周复盘已开启" : "解锁完整 AI 周复盘"}</div>
      <div class="hero-sub">当前版本用于 30 天真实用户测试，重点验证记录、复盘和付费意愿。</div>
      <div class="button-row">
        <button class="primary-btn" data-open="goal">调整目标</button>
        <button class="secondary-btn" data-action="export-csv">导出数据</button>
      </div>
      <div class="field section">
        <label>补充项目模板</label>
        <select id="appendTemplate">
          ${Object.entries(startTemplates).map(([key, item]) => `<option value="${key}">${item.label}</option>`).join("")}
        </select>
      </div>
      <button class="secondary-btn" data-action="append-template">添加模板项目</button>
      <div class="button-row">
        <button class="secondary-btn" data-action="export-backup">完整备份</button>
        <button class="secondary-btn" data-action="import-backup">导入备份</button>
      </div>
      <div class="button-row">
        <button class="secondary-btn" data-action="copy-share-link">复制分享链接</button>
        <button class="secondary-btn" data-action="send-feedback">反馈建议</button>
      </div>
      <input id="backupFile" type="file" accept="application/json,.json" hidden />
      <div class="button-row">
        <button class="secondary-btn" data-action="desktop-mode">桌面屏模式</button>
        <button class="danger-btn" data-action="reset-demo">重新开始</button>
      </div>
      ${
        getResetBackup()
          ? `<div class="button-row"><button class="secondary-btn" data-action="restore-reset-backup">恢复上次重新开始前的数据</button></div>`
          : ""
      }
    </section>
    <section class="section card">
      <span class="pill ${cloud.configured && cloud.session ? "green" : "orange"}">${cloud.configured ? "云端数据" : "本地数据"}</span>
      <div class="action-text">${cloud.configured && cloud.session ? "已登录云端账号" : "当前为本地模式"}</div>
      <div class="hero-sub">${cloud.session?.user?.email || "配置 Supabase 后可开启多人云端数据。"}</div>
      ${
        cloud.configured && cloud.session
          ? `<div class="button-row"><button class="secondary-btn" data-action="sync-now">立即同步</button><button class="danger-btn" data-action="auth-logout">退出登录</button></div>`
          : ""
      }
    </section>
    <section class="section notice">
      AI 生成内容仅供记录和复盘参考，不构成投资、理财、法律、税务、职业或创业成功建议。请结合自身情况独立判断。
    </section>
  `;
}

function renderDesktopMode() {
  const stats = getStats();
  return `
    <main class="desktop-screen">
      <button class="desktop-exit" data-action="exit-desktop">退出</button>
      <div class="desktop-brand">亿个小目标</div>
      <div class="desktop-label">距离 ${shortAmount(state.goal.targetAmount)} 目标还差</div>
      <div class="desktop-number">${money(stats.remaining)}</div>
      <div class="desktop-progress">
        <div style="width:${Math.min(100, stats.progress)}%"></div>
      </div>
      <div class="desktop-row">
        <span>已完成 ${money(stats.completed)}</span>
        <span>${percent(stats.progress)}</span>
      </div>
      <section class="desktop-action">
        <span>今日</span>
        <strong>${state.dailyAction.text}</strong>
        <em>${state.dailyAction.estimatedMinutes} 分钟 · ${state.dailyAction.projectName}</em>
      </section>
      <div class="desktop-foot">AI 内容仅供记录和复盘参考，不承诺任何收入结果。</div>
    </main>
  `;
}

function renderOnboarding() {
  const examples = getOnboardingExamples();
  return `
    <main class="onboarding">
      <section class="card">
        <div class="brand">亿</div>
        <div class="eyebrow">AI 赚钱目标作战台</div>
        <h1 class="title">用一段话生成你的赚钱作战台</h1>
        <p class="hero-sub">不用先建一堆表。说清楚你的经历、技能、资源和时间，系统会生成个人画像、推荐项目和今天第一步。</p>
        <div class="onboard-steps">
          <span>画像</span>
          <span>项目</span>
          <span>行动</span>
        </div>
        <div class="form section">
          <div class="field">
            <label>你的真实情况</label>
            <textarea id="onboardProfileText" placeholder="例如：我有10多年B端产品经验，正在学习AI，能做图文、视频和业务系统，每周能投入20小时，想在两年内赚到100万。"></textarea>
          </div>
          <div class="chips onboard-examples">
            ${examples.map((item) => `<button class="chip" data-onboard-example="${item.text}">${item.label}</button>`).join("")}
          </div>
          <details class="advanced-settings">
            <summary>调整目标金额</summary>
            <div class="field">
              <label>目标金额</label>
              <select id="onboardTarget">
                <option value="100000" selected>10 万</option>
                <option value="300000">30 万</option>
                <option value="500000">50 万</option>
                <option value="1000000">100 万</option>
              </select>
            </div>
            <div class="field">
              <label>截止日期</label>
              <input id="onboardDeadline" type="date" value="2026-12-31" />
            </div>
          </details>
          <button class="primary-btn" data-action="finish-onboarding">AI 生成我的赚钱作战台</button>
          <div class="notice">AI 内容仅供记录和复盘参考，不承诺任何收入结果。</div>
        </div>
      </section>
    </main>
  `;
}

function renderBottomNav() {
  const nav = [
    ["home", "⌂", "作战台"],
    ["record", "+", "记录"],
    ["projects", "▦", "项目"],
    ["review", "◴", "复盘"],
    ["me", "•", "我的"],
  ];
  return `
    <nav class="bottom-nav">
      ${nav
        .map(
          ([id, icon, label]) => `
          <button class="nav-item ${state.activeTab === id ? "active" : ""}" data-tab="${id}">
            <span>${icon}</span><span>${label}</span>
          </button>
        `,
        )
        .join("")}
    </nav>
  `;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal === "goal") return renderGoalModal();
  if (state.modal === "profile") return renderProfileModal();
  if (state.modal === "project") return renderProjectModal();
  if (state.modal === "record") return renderRecordModal();
  if (state.modal === "confirm") return renderConfirmModal();
  if (state.modal === "risk") return renderRiskModal();
  return "";
}

function renderProfileModal() {
  const profile = state.personalProfile || {};
  const recommendations = profile.recommendations || [];
  const projectDrafts = profile.projectDrafts || [];
  const hasProfileResult = Boolean(profile.role || profile.skills || profile.resources || recommendations.length);
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>个人画像</h2><button class="icon-btn" data-close>×</button></div>
        <div class="form">
          <div class="field">
            <label>用一段话描述你自己</label>
            <textarea id="profileRawText" placeholder="例如：我现在做设备销售，熟悉报价和客户沟通，有一些工厂老板资源。每周能投入6小时，想做稳一点的副业，不太想强销售。">${profile.rawText || ""}</textarea>
          </div>
          <button class="secondary-btn" data-action="analyze-profile">AI 识别画像</button>
          ${
            recommendations.length
              ? `<div class="profile-suggestions">${recommendations.map((item) => `<div>${item}</div>`).join("")}</div>`
              : `<div class="notice">先说一段真实情况，系统会自动提取画像并给出推荐。后续可接入大模型，让识别更细。</div>`
          }
          ${
            hasProfileResult
              ? `<div class="profile-summary-grid">
                  <div><span>身份</span><strong>${profile.role || "未识别"}</strong></div>
                  <div><span>技能</span><strong>${profile.skills || "未识别"}</strong></div>
                  <div><span>资源</span><strong>${profile.resources || "未识别"}</strong></div>
                  <div><span>时间</span><strong>${profile.weeklyHours || 0} 小时/周</strong></div>
                  <div><span>风险</span><strong>${profile.riskPreference || "稳健"}</strong></div>
                  <div><span>销售</span><strong>${profile.salesComfort || "可以尝试"}</strong></div>
                </div>`
              : ""
          }
          ${
            projectDrafts.length
              ? `<div class="section-head"><h2 class="section-title">AI 推荐项目</h2></div>
                <div class="project-drafts">
                  ${projectDrafts
                    .map(
                      (item, index) => `
                        <article class="project-draft">
                          <div>
                            <strong>${item.name}</strong>
                            <span>${item.targetCustomer}</span>
                          </div>
                          <div class="profile-list">
                            <div><strong>变现方式</strong><span>${item.monetization}</span></div>
                            <div><strong>下一步</strong><span>${item.nextAction}</span></div>
                            <div><strong>风险提醒</strong><span>${item.riskWarning}</span></div>
                          </div>
                          <button class="secondary-btn" data-add-profile-project="${index}">添加为项目</button>
                        </article>
                      `,
                    )
                    .join("")}
                </div>`
              : ""
          }
          <details class="advanced-settings">
            <summary>展开编辑识别结果</summary>
            <div class="field"><label>当前职业/身份</label><input id="profileRole" placeholder="例如：设备销售 / 产品经理 / 自由职业" value="${profile.role || ""}" /></div>
            <div class="field"><label>收入压力/当前处境</label><input id="profilePressure" placeholder="例如：想增加副业收入、转型、现金流紧" value="${profile.incomePressure || ""}" /></div>
            <div class="field"><label>每周可投入时间</label><input id="profileHours" type="number" min="0" value="${profile.weeklyHours || state.goal.weeklyHours || 0}" /></div>
            <div class="field"><label>技能</label><textarea id="profileSkills" placeholder="销售、报价、内容、交付、AI工具、行业经验等">${profile.skills || ""}</textarea></div>
            <div class="field"><label>资源</label><textarea id="profileResources" placeholder="客户资源、人脉、行业资源、设备、渠道等">${profile.resources || ""}</textarea></div>
            <div class="field">
              <label>赚钱偏好</label>
              <select id="profilePreference">
                ${["副业变现", "接单服务", "小生意经营", "求职涨薪", "创业项目"].map((item) => `<option ${profile.earningPreference === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>风险偏好</label>
              <select id="profileRisk">
                ${["保守", "稳健", "积极"].map((item) => `<option ${profile.riskPreference === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>销售接受度</label>
              <select id="profileSales">
                ${["抗拒销售", "可以尝试", "愿意主动销售"].map((item) => `<option ${profile.salesComfort === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>常用 AI 工具</label><input id="profileAiTools" placeholder="例如：ChatGPT、Claude、豆包、即梦、剪映" value="${profile.aiTools || ""}" /></div>
            <button class="primary-btn" data-action="save-profile">保存画像</button>
          </details>
        </div>
      </section>
    </div>
  `;
}

function renderGoalModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>目标设置</h2><button class="icon-btn" data-close>×</button></div>
        <div class="form">
          <div class="field"><label>目标名称</label><input id="goalName" value="${state.goal.name}" /></div>
          <div class="field"><label>目标金额</label><input id="goalTarget" type="number" value="${state.goal.targetAmount}" /></div>
          <div class="field"><label>当前已完成</label><input id="goalInitial" type="number" value="${state.goal.initialAmount}" /></div>
          <div class="field"><label>截止日期</label><input id="goalDeadline" type="date" value="${state.goal.deadline}" /></div>
          <div class="field"><label>每周可投入时间</label><input id="goalHours" type="number" value="${state.goal.weeklyHours}" /></div>
          <button class="primary-btn" data-action="save-goal">保存目标</button>
        </div>
      </section>
    </div>
  `;
}

function renderProjectModal() {
  const editing = state.projects.find((project) => project.id === state.editProjectId);
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>${editing ? "编辑项目" : "新建项目"}</h2><button class="icon-btn" data-close>×</button></div>
        <div class="form">
          <div class="field"><label>项目名称</label><input id="projectName" placeholder="例如：咨询服务" value="${editing?.name || ""}" /></div>
          <div class="field"><label>项目类型</label><select id="projectType">${projectTypes.map((item) => `<option ${editing?.type === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field"><label>状态</label><select id="projectStatus">${projectStatuses.map((item) => `<option ${editing?.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field"><label>阶段</label><select id="projectStage">${projectStages.map((item) => `<option ${editing?.stage === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field"><label>目标客户</label><input id="projectTargetCustomer" placeholder="例如：有设备搬迁/改造需求的工厂" value="${editing?.targetCustomer || ""}" /></div>
          <div class="field"><label>变现方式</label><input id="projectMonetization" placeholder="例如：方案报价、服务费、产品销售、咨询费" value="${editing?.monetization || ""}" /></div>
          <div class="field"><label>下一步关键动作</label><input id="projectNextAction" placeholder="例如：跟进报价、联系3个类似客户" value="${editing?.nextAction || ""}" /></div>
          <button class="primary-btn" data-action="save-project">${editing ? "保存修改" : "保存项目"}</button>
          ${editing ? `<button class="danger-btn" data-action="delete-project">删除项目</button>` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderRecordModal() {
  const editing = state.records.find((item) => item.id === state.editRecordId);
  if (!editing) return "";
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>编辑记录</h2><button class="icon-btn" data-close>×</button></div>
        <div class="form">
          <div class="field">
            <label>类型</label>
            <select id="recordType">
              <option value="income" ${editing.recordType === "income" ? "selected" : ""}>收入</option>
              <option value="expense" ${editing.recordType === "expense" ? "selected" : ""}>支出</option>
              <option value="action" ${editing.recordType === "action" ? "selected" : ""}>行动</option>
            </select>
          </div>
          <div class="field"><label>金额</label><input id="recordAmount" type="number" value="${editing.amount || 0}" /></div>
          <div class="field">
            <label>项目</label>
            <select id="recordProjectId">
              <option value="" ${!editing.projectId ? "selected" : ""}>未关联/个人事项</option>
              ${state.projects.map((project) => `<option value="${project.id}" ${project.id === editing.projectId ? "selected" : ""}>${project.name}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>日期</label><input id="recordDate" type="date" value="${editing.occurredAt || todayISO()}" /></div>
          <div class="field"><label>备注</label><input id="recordNote" value="${editing.note || ""}" /></div>
          <label class="check-row">
            <input id="recordIncluded" type="checkbox" ${editing.includedInGoal ? "checked" : ""} />
            <span>计入目标进度</span>
          </label>
          <button class="primary-btn" data-action="save-record-edit">保存记录</button>
        </div>
      </section>
    </div>
  `;
}

function renderConfirmModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>确认记录</h2><button class="icon-btn" data-close>×</button></div>
        <div class="confirm-list">
          ${state.draftRecords
            .map(
              (item, index) => `
              <article class="card">
                <div class="form">
                  <div class="field">
                    <label>类型</label>
                    <select data-draft="${index}" data-field="recordType">
                      <option value="income" ${item.recordType === "income" ? "selected" : ""}>收入</option>
                      <option value="expense" ${item.recordType === "expense" ? "selected" : ""}>支出</option>
                      <option value="action" ${item.recordType === "action" ? "selected" : ""}>行动</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>金额${item.currency === "USD" ? `（${item.originalAmount} USD，按 ${item.exchangeRate} 换算）` : ""}</label>
                    <input type="number" data-draft="${index}" data-field="amount" value="${item.amount || 0}" />
                  </div>
                  <div class="field">
                    <label>项目</label>
                    <select data-draft="${index}" data-field="projectId">
                      <option value="" ${!item.projectId ? "selected" : ""}>未关联/个人事项</option>
                      ${state.projects.map((project) => `<option value="${project.id}" ${project.id === item.projectId ? "selected" : ""}>${project.name}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field"><label>备注</label><input data-draft="${index}" data-field="note" value="${item.note || ""}" /></div>
                </div>
              </article>
            `,
            )
            .join("")}
          <div class="button-row">
            <button class="primary-btn" data-action="save-drafts">全部保存</button>
            <button class="danger-btn" data-close>取消</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderRiskModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head"><h2>高风险内容提醒</h2><button class="icon-btn" data-close>×</button></div>
        <section class="card">
          <p class="review-block">我不能为你提供个性化投资、借贷或高风险经营决策建议。我可以帮你整理目标、预算、成本、风险清单，以及适合进一步咨询专业人士的问题。</p>
          <div class="button-row"><button class="primary-btn" data-close>知道了</button></div>
        </section>
      </section>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      state.activeProjectId = null;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = button.dataset.open;
      render();
    });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = null;
      state.draftRecords = [];
      state.editProjectId = null;
      state.editRecordId = null;
      render();
    });
  });

  document.querySelectorAll("[data-project]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeTab = "projects";
      state.activeProjectId = card.dataset.project;
      render();
    });
  });

  document.querySelectorAll("[data-delete-record]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteRecord(button.dataset.deleteRecord);
    });
  });

  document.querySelectorAll("[data-edit-project]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editProjectId = button.dataset.editProject;
      state.modal = "project";
      render();
    });
  });

  document.querySelectorAll("[data-edit-record]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editRecordId = button.dataset.editRecord;
      state.modal = "record";
      render();
    });
  });

  document.querySelectorAll("[data-set-action]").forEach((button) => {
    button.addEventListener("click", () => setReviewAction(Number(button.dataset.setAction)));
  });

  document.querySelectorAll("[data-add-profile-project]").forEach((button) => {
    button.addEventListener("click", () => addProfileProjectDraft(Number(button.dataset.addProfileProject)));
  });

  document.querySelectorAll("[data-coach-question]").forEach((button) => {
    button.addEventListener("click", () => startCoachQuestion(button.dataset.coachQuestion));
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector("#recordText");
      if (input) {
        input.value = button.dataset.example;
        state.recordInputText = input.value;
        state.recordNotice = "";
      }
    });
  });

  document.querySelectorAll("[data-onboard-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector("#onboardProfileText");
      if (input) input.value = button.dataset.onboardExample;
    });
  });

  const recordText = document.querySelector("#recordText");
  if (recordText) {
    recordText.addEventListener("input", () => {
      state.recordInputText = recordText.value;
      state.recordNotice = "";
    });
  }

  const recordProject = document.querySelector("#recordProjectId");
  if (recordProject) {
    recordProject.addEventListener("change", () => {
      state.recordProjectId = recordProject.value;
      state.recordNotice = "";
    });
  }

  const backupFile = document.querySelector("#backupFile");
  if (backupFile) {
    backupFile.addEventListener("change", importBackupFile);
  }

  document.querySelectorAll("[data-draft]").forEach((input) => {
    input.addEventListener("input", () => updateDraft(input));
    input.addEventListener("change", () => updateDraft(input));
  });

  const onboardTemplate = document.querySelector("#onboardTemplate");
  if (onboardTemplate) {
    onboardTemplate.addEventListener("change", () => {
      const projectInput = document.querySelector("#onboardProject");
      const template = startTemplates[onboardTemplate.value];
      if (projectInput && template) projectInput.value = template.projects[0][0];
    });
  }

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });
}

function updateDraft(input) {
  const index = Number(input.dataset.draft);
  const field = input.dataset.field;
  if (!state.draftRecords[index]) return;
  state.draftRecords[index][field] = field === "amount" ? Number(input.value) : input.value;
}

function handleAction(action) {
  if (action === "auth-login") signIn();
  if (action === "auth-signup") signUp();
  if (action === "auth-logout") signOut();
  if (action === "sync-now") syncNow();
  if (action === "finish-onboarding") finishOnboarding();
  if (action === "analyze-profile") analyzeProfile();
  if (action === "save-profile") saveProfile();
  if (action === "save-goal") saveGoal();
  if (action === "new-project") {
    state.editProjectId = null;
    state.modal = "project";
    render();
  }
  if (action === "save-project") saveProject();
  if (action === "delete-project") deleteProject();
  if (action === "save-record-edit") saveRecordEdit();
  if (action === "voice-input") startVoiceInput();
  if (action === "parse-record") parseRecord();
  if (action === "save-drafts") saveDrafts();
  if (action === "complete-action") completeAction();
  if (action === "refresh-action") refreshAction();
  if (action === "desktop-mode") {
    state.desktopMode = true;
    saveState();
    render();
  }
  if (action === "exit-desktop") {
    state.desktopMode = false;
    saveState();
    render();
  }
  if (action === "unlock-pro") unlockPro();
  if (action === "export-csv") exportCsv();
  if (action === "export-backup") exportBackup();
  if (action === "append-template") appendTemplateProjects();
  if (action === "import-backup") {
    const input = document.querySelector("#backupFile");
    if (input) input.click();
  }
  if (action === "copy-share-link") copyShareLink();
  if (action === "copy-profile-share") copyProfileShareText();
  if (action === "copy-purchase-guide") copyPurchaseGuide();
  if (action === "copy-order-template") copyOrderTemplate();
  if (action === "copy-paid-report") copyPaidDiagnosisReport();
  if (action === "copy-self-intro") copySelfIntroText();
  if (action === "copy-content-pack") copyContentPackText();
  if (action === "send-feedback") sendFeedback();
  if (action === "back-projects") {
    state.activeProjectId = null;
    render();
  }
  if (action === "reset-demo") {
    resetAppData();
  }
  if (action === "restore-reset-backup") restoreResetBackup();
}

function finishOnboarding() {
  const text = document.querySelector("#onboardProfileText")?.value.trim();
  if (!text) {
    alert("先用一段话说说你的职业、技能、资源和时间。");
    return;
  }
  const target = Number(document.querySelector("#onboardTarget")?.value || 100000);
  const deadline = document.querySelector("#onboardDeadline")?.value || "2026-12-31";
  const plan = createOnboardingPlan(text, { targetAmount: target, deadline });
  state.hasOnboarded = true;
  state.goal = plan.goal;
  state.personalProfile = plan.profile;
  state.projects = plan.projects;
  state.records = [];
  state.dailyAction = plan.dailyAction;
  state.activeTab = "me";
  saveState();
  render();
}

function getAuthFields() {
  return {
    email: document.querySelector("#authEmail")?.value.trim(),
    password: document.querySelector("#authPassword")?.value,
  };
}

async function signIn() {
  if (!cloud.client) return;
  const { email, password } = getAuthFields();
  if (!email || !password) {
    cloud.error = "请输入邮箱和密码。";
    render();
    return;
  }
  const { data, error } = await cloud.client.auth.signInWithPassword({ email, password });
  if (error) {
    cloud.error = error.message;
    render();
    return;
  }
  cloud.error = "";
  cloud.session = data.session;
  await loadCloudState();
  render();
}

async function signUp() {
  if (!cloud.client) return;
  const { email, password } = getAuthFields();
  if (!email || !password || password.length < 6) {
    cloud.error = "请输入邮箱，并设置至少 6 位密码。";
    render();
    return;
  }
  const { data, error } = await cloud.client.auth.signUp({ email, password });
  if (error) {
    cloud.error = error.message;
    render();
    return;
  }
  cloud.error = "";
  cloud.session = data.session;
  if (cloud.session) await uploadCloudState();
  render();
}

async function signOut() {
  if (!cloud.client) return;
  await uploadCloudState();
  await cloud.client.auth.signOut();
  cloud.session = null;
  state = loadState();
  render();
}

async function syncNow() {
  await uploadCloudState();
  render();
}

function saveProfile() {
  const current = state.personalProfile || {};
  const weeklyHours = Number(document.querySelector("#profileHours")?.value || current.weeklyHours || state.goal.weeklyHours || 0);
  state.personalProfile = {
    rawText: document.querySelector("#profileRawText")?.value.trim() || current.rawText || "",
    role: document.querySelector("#profileRole")?.value.trim() || current.role || "",
    incomePressure: document.querySelector("#profilePressure")?.value.trim() || current.incomePressure || "",
    weeklyHours,
    skills: document.querySelector("#profileSkills")?.value.trim() || current.skills || "",
    resources: document.querySelector("#profileResources")?.value.trim() || current.resources || "",
    earningPreference: document.querySelector("#profilePreference")?.value || current.earningPreference || "副业变现",
    riskPreference: document.querySelector("#profileRisk")?.value || current.riskPreference || "稳健",
    salesComfort: document.querySelector("#profileSales")?.value || current.salesComfort || "可以尝试",
    aiTools: document.querySelector("#profileAiTools")?.value.trim() || current.aiTools || "",
    recommendations: current.recommendations || [],
    projectDrafts: current.projectDrafts || [],
  };
  state.goal = {
    ...state.goal,
    weeklyHours,
    riskPreference: state.personalProfile.riskPreference,
  };
  state.modal = null;
  saveState();
  render();
}

function analyzeProfile() {
  const text = document.querySelector("#profileRawText")?.value.trim();
  if (!text) {
    alert("先用一段话描述你的职业、技能、资源、时间和赚钱想法。");
    return;
  }
  const result = parseNaturalProfile(text);
  state.personalProfile = {
    ...state.personalProfile,
    ...result.profile,
    rawText: text,
    recommendations: result.recommendations,
    projectDrafts: result.projectDrafts,
  };
  state.goal = {
    ...state.goal,
    weeklyHours: result.profile.weeklyHours || state.goal.weeklyHours,
    riskPreference: result.profile.riskPreference || state.goal.riskPreference,
  };
  state.dailyAction = generateAction();
  saveState();
  state.modal = "profile";
  render();
}

function parseNaturalProfile(text) {
  const normalized = text.replace(/\s+/g, "");
  const hoursMatch = text.match(/每周[^，。；;、\n]{0,8}?(\d+(?:\.\d+)?)\s*(?:个)?小时/);
  const weeklyHours = hoursMatch ? Number(hoursMatch[1]) : state.personalProfile?.weeklyHours || state.goal.weeklyHours || 8;
  const role = extractProfileRole(text);
  const skills = pickPhrases(text, [
    "报价",
    "客户沟通",
    "销售",
    "售前",
    "方案",
    "解决方案",
    "招投标",
    "需求分析",
    "交付",
    "内容",
    "剪辑",
    "写作",
    "AI",
    "AI工具",
    "图文",
    "视频",
    "业务系统",
    "系统生成",
    "运营",
    "设计",
    "产品",
    "行业经验",
  ]);
  const resources = pickResourcePhrases(text);
  const riskPreference = /保守|稳一点|稳健|不想亏|别亏|低风险|安全/.test(normalized)
    ? "稳健"
    : /激进|大胆|高风险|快速放大|创业/.test(normalized)
      ? "积极"
      : state.personalProfile?.riskPreference || "稳健";
  const salesComfort = /不想.*销售|不太想.*销售|不想强销售|抗拒销售|不会社交|怕推销|不想主动/.test(normalized)
    ? "抗拒销售"
    : /愿意.*销售|主动销售|能陌拜|能打电话|能成交/.test(normalized)
      ? "愿意主动销售"
      : "可以尝试";
  const earningPreference = /求职|面试|跳槽|涨薪/.test(normalized)
    ? "求职涨薪"
    : /创业|项目|公司/.test(normalized)
      ? "创业项目"
      : /生意|门店|工厂|设备|产品销售/.test(normalized)
        ? "小生意经营"
        : /接单|服务|咨询|方案/.test(normalized)
          ? "接单服务"
          : "副业变现";
  const incomePressure = extractProfilePressure(text);
  const aiTools = pickPhrases(text, ["ChatGPT", "Claude", "Codex", "DeepSeek", "豆包", "即梦", "剪映", "通义", "Kimi"]);
  const profile = {
    rawText: text,
    role,
    incomePressure,
    weeklyHours,
    skills,
    resources,
    earningPreference,
    riskPreference,
    salesComfort,
    aiTools,
  };
  return {
    profile,
    recommendations: buildProfileRecommendations(profile),
    projectDrafts: buildProjectDrafts(profile),
  };
}

function extractProfileRole(text) {
  const patterns = [
    /(?:我是|我现在做|目前做|职业是|身份是)([^，。；;、\n]{2,18})/,
    /(设备销售|产品经理|销售|售前|自由职业|老板|宝妈|老师|设计师|运营|程序员|工程师|咨询顾问)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return (match[1] || match[0]).replace(/，|。/g, "").trim();
  }
  return state.personalProfile?.role || "";
}

function extractProfilePressure(text) {
  const match = text.match(/(想[^，。；;、\n]{2,24}|希望[^，。；;、\n]{2,24}|收入[^，。；;、\n]{2,24}|现金流[^，。；;、\n]{2,24})/);
  return match ? match[0] : state.personalProfile?.incomePressure || "";
}

function pickPhrases(text, words) {
  return words.filter((word) => text.toLowerCase().includes(word.toLowerCase())).join("、");
}

function pickResourcePhrases(text) {
  const words = ["工厂老板", "客户资源", "老客户", "人脉", "行业资源", "渠道", "供应链", "社群", "私域", "粉丝", "小红书", "抖音", "行业拆解", "账号"];
  const picked = pickPhrases(text, words);
  if (picked) return picked;
  const match = text.match(/(?:有|手里有|认识)([^，。；;、\n]{2,24}(?:资源|客户|老板|渠道|人脉))/);
  return match ? match[1] : "";
}

function buildProfileRecommendations(profile) {
  const customer = profile.resources || "已有资源";
  const lowPressure = profile.salesComfort === "抗拒销售";
  const timeBox = profile.weeklyHours <= 6 ? "每次控制在 25 分钟内" : "每周固定 2-3 个推进时段";
  const projectType =
    profile.earningPreference === "小生意经营"
      ? "优先做围绕现有客户资源的低成本成交验证"
      : profile.earningPreference === "求职涨薪"
        ? "优先把技能和案例整理成可展示作品"
        : "优先做可快速验证付费意愿的接单/咨询项目";
  const action = lowPressure
    ? `先整理 1 个案例发给熟人、老客户或${customer}，用反馈代替强推`
    : `联系 3 个${customer}，验证对方是否愿意为你的能力付费`;
  return [
    projectType,
    `${timeBox}，下一步建议：${action}`,
    "暂不建议重资产投入、囤货或承诺收益，先用真实反馈验证。",
  ];
}

function buildProfileDisplay(profile = {}, projects = []) {
  const text = `${profile.role || ""} ${profile.skills || ""} ${profile.resources || ""} ${profile.aiTools || ""}`;
  const hasAi = /AI|AIGC|ChatGPT|Claude|Codex|DeepSeek|图文生成|视频生成|业务系统生成/i.test(text);
  const hasB2b = /B端|产品|售前|解决方案|招投标|投标|需求|客户|企业|业务系统/.test(text);
  const hasContent = /小红书|抖音|视频|图文|内容|运营|账号|行业拆解/.test(text);
  const hasDesign = /设计|视觉|出图|图片|海报/.test(text);
  const hasDelivery = /交付|系统|低代码|原型|PRD|流程|业务产品/.test(text);
  const identityTags = uniqueList([
    hasB2b ? "B端产品/售前" : "",
    hasAi ? "AI应用落地" : "",
    hasDelivery ? "数字化解决方案" : "",
    hasContent ? "行业内容IP" : "",
    hasDesign ? "设计表达" : "",
    profile.earningPreference ? profile.earningPreference : "",
    profile.riskPreference ? `${profile.riskPreference}推进` : "",
  ]).slice(0, 8);
  const assetTags = uniqueList([
    /需求|产品/.test(text) ? "需求分析" : "",
    /解决方案|方案/.test(text) ? "解决方案设计" : "",
    /售前|客户/.test(text) ? "客户沟通/售前" : "",
    /招投标|投标/.test(text) ? "招投标响应" : "",
    hasAi ? "AI工具应用" : "",
    /图文|出图|图片/.test(text) ? "AI图文生成" : "",
    /视频|剪辑|抖音/.test(text) ? "AI视频生成" : "",
    /业务系统|低代码|原型|系统生成/.test(text) ? "AI业务系统生成" : "",
    /小红书|抖音|账号|粉丝/.test(text) ? "内容账号运营" : "",
  ]).slice(0, 9);
  const projectNames = uniqueList(projects.map((project) => project?.name).filter(Boolean));
  const monetizationTags = uniqueList([
    ...projectNames,
    hasAi && hasB2b ? "AI业务系统生成咨询" : "",
    hasB2b ? "企业数字化方案/售前咨询" : "",
    hasContent ? "行业拆解内容获客" : "",
    hasDelivery ? "原型、PRD、投标材料服务" : "",
  ])
    .filter(Boolean)
    .slice(0, 5);
  const firstProject = projects.find((project) => project?.nextAction || project?.name) || {};
  const firstCustomer = firstProject.targetCustomer || "已有资源中的潜在付费客户";
  const firstAction = firstProject.nextAction || "整理1个可展示案例";
  const mainProject = firstProject.name || monetizationTags[0] || "个人能力变现项目";
  const positioning =
    hasAi && hasB2b
      ? "AI应用解决方案服务商"
      : hasAi
        ? "AI能力变现服务商"
        : hasB2b
          ? "B端解决方案服务商"
          : profile.role || "个人能力变现者";
  return {
    positioning,
    identityTags: identityTags.length ? identityTags : ["个人能力变现者"],
    assetTags: assetTags.length ? assetTags : ["经验资产", "执行能力", "学习能力"],
    monetizationTags: monetizationTags.length ? monetizationTags : ["咨询服务", "项目制交付", "内容获客"],
    servicePackages: uniqueList([
      hasAi && hasB2b ? "AI业务诊断包：梳理业务流程、痛点和可自动化环节" : "",
      hasAi && hasB2b ? "系统原型包：用AI快速生成可演示的业务系统原型" : "",
      hasB2b ? "方案材料包：PRD、解决方案、投标/售前材料整理" : "",
      hasContent ? "行业内容包：行业拆解图文/短视频，导向咨询线索" : "",
    ]).slice(0, 4),
    contentTopics: uniqueList([
      hasContent ? "用AI拆解一个行业的赚钱机会" : "",
      hasAi && hasB2b ? "我如何用AI快速做出一个业务系统原型" : "",
      hasB2b ? "中小企业做数字化最容易踩的坑" : "",
      firstProject.name ? `${firstProject.name}真实案例复盘` : "",
    ]).slice(0, 4),
    firstCustomers: uniqueList([
      firstCustomer,
      hasB2b ? "正在招产品/运营/数字化岗位但缺方案能力的小企业" : "",
      hasContent ? "从小红书/抖音行业拆解内容咨询过的人" : "",
      "过往项目里的老客户、熟人和转介绍对象",
    ]).slice(0, 4),
    avoidList: [
      "不要承诺稳赚、保收益或一定成交。",
      "不要一开始承诺完整开发交付，先卖诊断、原型和方案。",
      "不要先重资产投入、囤货或扩大团队，先验证真实付款。",
    ],
    roadmap: [
      `0-30天：${shortActionText(firstAction)}，沉淀1个可展示案例。`,
      `1-3个月：围绕「${mainProject}」找到3个真实需求，验证诊断费或小额服务费。`,
      "3-12个月：把高频需求做成标准化服务包，形成可复用报价、交付清单和案例库。",
      "12-24个月：筛选利润更高的客户类型，扩大渠道和转介绍，谨慎考虑团队化或产品化。",
    ],
  };
}

function buildFirstDaySummary(profile = {}, projects = [], dailyAction = {}) {
  const display = buildProfileDisplay(profile, projects);
  const firstProject = projects[0] || {};
  return {
    positioning: display.positioning,
    firstProject: firstProject.name || display.monetizationTags[0] || "个人能力变现项目",
    firstAction: dailyAction.text || shortActionText(firstProject.nextAction || "整理1个可展示案例"),
    servicePackage: display.servicePackages[0] || "先卖诊断、方案或小额服务，不先重投入",
    firstCustomer: display.firstCustomers[0] || firstProject.targetCustomer || "已有资源中的潜在付费客户",
    quickWins: ["复制画像文案发给朋友或社群", "记录今天第一笔收入/支出/行动", "按第一步行动推进25分钟"],
  };
}

function buildAICoachInsight() {
  const profile = state.personalProfile || {};
  const projects = state.projects || [];
  const records = state.records || [];
  const display = buildProfileDisplay(profile, projects);
  const action = state.dailyAction || generateAction();
  const project = projects.find((item) => item.name === action.projectName) || projects[0] || {};
  const hasCustomerSignal = records.some((item) => /客户|成交|咨询|付款|反馈|沟通/.test(item.note || item.sourceText || ""));
  const strongestAsset = display.assetTags.slice(0, 3).join("、") || profile.skills || "你的经验资产";
  const bestPath = project.name || display.monetizationTags[0] || "先验证一个可收费的小服务";
  const actionText = action.text || shortActionText(project.nextAction || "记录今天的一笔进展");
  const reason = hasCustomerSignal
    ? `你已经有客户反馈或交易记录，AI 建议继续围绕「${bestPath}」放大真实需求。`
    : `你现在最缺的是客户反馈和真实需求样本，所以先做「${actionText}」，比继续空想方案更重要。`;
  const risk =
    records.length === 0
      ? "记录样本还太少，容易凭感觉判断项目好坏。"
      : getStats().weekNet < 0
        ? "本周净收益为负，新增投入前要先复盘成本来源。"
        : "不要过早承诺完整交付或保证收益，先验证小额付款。";
  return {
    todayJudgment: `AI 建议你今天只做一件事：${actionText}。`,
    reason,
    diagnosis: {
      summary: `AI 判断你更适合先做「${bestPath}」，用小服务验证需求。`,
      strongestAsset,
      bestPath,
      risk,
      next7Days: `围绕「${actionText}」连续记录反馈，至少拿到1个客户问题或1次真实沟通。`,
    },
    followUpQuestions: buildCoachQuestions(profile, project, records),
    boundary: "AI 诊断仅供记录、复盘和行动参考，不承诺收益、不保证成交。",
  };
}

function buildCoachQuestions(profile = {}, project = {}, records = []) {
  const questions = [];
  if (!project.targetCustomer) questions.push("你的第一批客户具体是谁？");
  if (!project.monetization) questions.push("这件事准备用什么方式收费？");
  if (!records.length) questions.push("今天有没有一次客户沟通、成交或反馈？");
  if (!profile.salesComfort) questions.push("你能接受主动私聊客户吗？");
  questions.push(`围绕「${project.name || "当前项目"}」最近一次真实客户反馈是什么？`);
  questions.push("如果7天没收入，你准备暂停、调整还是继续验证？");
  return uniqueList(questions).slice(0, 3);
}

function buildContentStarterPack(profile = {}, projects = []) {
  const display = buildProfileDisplay(profile, projects);
  const project = projects[0] || {};
  const customer = display.firstCustomers[0] || project.targetCustomer || "潜在客户";
  const service = display.servicePackages[0] || display.monetizationTags[0] || "小额咨询服务";
  const firstAction = shortActionText(project.nextAction || "整理1个可展示案例");
  const baseTopics = [
    {
      title: display.contentTopics[0] || `我为什么开始做${display.positioning}`,
      hook: `适合发小红书/抖音：用自己的经历讲清楚你能帮${customer}解决什么问题。`,
      outline: [`我过去积累了什么能力`, `现在准备用${service}解决什么问题`, `我正在找哪类真实需求`],
    },
    {
      title: display.contentTopics[1] || `用AI把一个业务问题做成可演示方案`,
      hook: "适合做案例帖：展示从问题、流程、原型到交付清单的过程。",
      outline: ["先描述一个真实业务场景", "展示AI如何拆解流程和生成原型", "说明适合先买诊断/原型而不是直接开发"],
    },
    {
      title: `${firstAction}：我今天推进赚钱目标的第一步`,
      hook: "适合做成长记录：让别人看到你不是空谈，而是在连续行动。",
      outline: ["今天做了哪一个动作", "遇到什么反馈或卡点", "明天准备验证什么"],
    },
  ];
  return {
    intro: buildSelfIntroText(profile, projects),
    topics: baseTopics.slice(0, 3),
  };
}

function buildSelfIntroText(profile = {}, projects = []) {
  const display = buildProfileDisplay(profile, projects);
  const project = projects[0] || {};
  const firstCustomer = display.firstCustomers[0] || project.targetCustomer || "有真实需求的人";
  const service = display.servicePackages[0] || "诊断、方案和小额服务";
  const firstAction = shortActionText(project.nextAction || "整理1个可展示案例");
  return [
    `我是${display.positioning}。`,
    `我擅长：${display.assetTags.slice(0, 4).join("、")}。`,
    `现在我想先服务：${firstCustomer}。`,
    `我能提供的第一类服务是：${service}。`,
    `我目前的第一步是：${firstAction}。`,
    "提醒：以上是个人行动记录和服务介绍，不承诺收益、不保证成交。",
  ].join("\n");
}

function buildProfileShareText(profile = {}, projects = []) {
  const display = buildProfileDisplay(profile, projects);
  const firstAction = display.roadmap[0]?.replace(/^0-30天：/, "") || "整理1个可展示案例。";
  return [
    `我的AI赚钱画像：${display.positioning}`,
    "",
    `身份标签：${display.identityTags.slice(0, 4).join(" / ")}`,
    `能力资产：${display.assetTags.slice(0, 5).join(" / ")}`,
    "",
    "推荐服务包：",
    ...display.servicePackages.slice(0, 3).map((item, index) => `${index + 1}. ${item}`),
    "",
    "内容选题：",
    ...display.contentTopics.slice(0, 3).map((item, index) => `${index + 1}. ${item}`),
    "",
    `第一批客户：${display.firstCustomers.slice(0, 2).join("；")}`,
    `第一步：${firstAction}`,
    "",
    "提醒：AI只做记录、复盘和行动参考，不承诺收益。",
    "我用这个工具做自己的赚钱目标作战台：",
    "https://sabina86589089.github.io/yigexiaomubiao/",
  ].join("\n");
}

function buildPaidDiagnosisReport(profile = state.personalProfile || {}, projects = state.projects || [], dailyAction = state.dailyAction || {}) {
  const display = buildProfileDisplay(profile, projects);
  const firstDay = buildFirstDaySummary(profile, projects, dailyAction);
  const coach = buildAICoachInsight();
  const contentPack = buildContentStarterPack(profile, projects);
  const title = "AI个人赚钱画像诊断";
  const priceLabel = "内测交付价 ¥99";
  const summary = `基于你的${display.positioning}画像，AI 会先整理方向，我再做一次人工复核，避免只给你几条泛泛建议。`;
  const valuePromise = `付款后交付「AI初诊 + 人工复核 + 7天行动计划」：帮你看清先做什么、找谁验证、今天怎么开始。`;
  const limitedOffer = "内测限 10 人，适合想用 AI 做副业/接单/转型但方向不清的人。";
  const deliverables = [
    "1份个人商业化诊断报告",
    "1个优先项目建议",
    "1组第一批客户画像",
    "1份7天行动计划",
    "3条内容获客选题",
    "1次人工复核优化",
  ];
  const sections = [
    {
      title: "个人商业化标签",
      items: [display.positioning, ...display.identityTags.slice(0, 4)],
    },
    {
      title: "最适合先做的项目",
      items: [firstDay.firstProject, coach.diagnosis.bestPath, firstDay.servicePackage],
    },
    {
      title: "第一批目标客户",
      items: display.firstCustomers.slice(0, 3),
    },
    {
      title: "7天行动计划",
      items: [
        firstDay.firstAction,
        coach.diagnosis.next7Days,
        "每天记录一次客户反馈、收入、支出或行动结果。",
      ],
    },
    {
      title: "内容获客选题",
      items: contentPack.topics.map((item) => item.title).slice(0, 3),
    },
    {
      title: "不建议做",
      items: display.avoidList,
    },
  ].map((section) => ({
    ...section,
    items: uniqueList(section.items.filter(Boolean)).slice(0, 4),
  }));
  const purchaseSteps = [
    `添加运营微信：${salesContact.wechat}`,
    "发送你的背景、技能、资源、目标金额和每周可投入时间。",
    "确认内测名额后付款 99 元。",
    "付款后发送截图，系统生成初稿，我再做一次人工复核。",
    "交付诊断报告，并邀请你连续记录 7 天行动结果。",
  ];
  const payment = {
    title: "购买与付款方式",
    method: "支付宝扫码付款",
    qrSrc: salesContact.paymentQrSrc,
    copy: `${salesContact.paymentHint} 当前版本先走人工确认，暂不做自动扣款；这样更适合内测阶段收集真实反馈。`,
  };
  const orderTemplate = [
    "我要购买：AI个人赚钱画像诊断 ¥99",
    "我的称呼：",
    "我的微信：",
    "当前背景：",
    "技能/资源：",
    "目标金额/期限：",
    "每周可投入时间：",
    "现在最想解决的问题：",
    "付款截图：已付款后补充",
  ].join("\n");
  const boundary = "本报告用于记录、复盘和行动参考，不承诺收益、不保证成交，不构成投资、职业或创业成功建议。";
  const copyText = [
    `# ${title}`,
    priceLabel,
    "",
    summary,
    valuePromise,
    limitedOffer,
    "",
    "## 你会拿到",
    ...deliverables.map((item) => `- ${item}`),
    "",
    "## 购买流程",
    ...purchaseSteps.map((item) => `- ${item}`),
    "",
    "## 下单资料模板",
    orderTemplate,
    "",
    ...sections.flatMap((section) => [`## ${section.title}`, ...section.items.map((item) => `- ${item}`), ""]),
    `## ${payment.title}`,
    payment.copy,
    "",
    boundary,
  ].join("\n");
  return {
    title,
    priceLabel,
    summary,
    valuePromise,
    limitedOffer,
    deliverables,
    sections,
    purchaseSteps,
    payment,
    orderTemplate,
    boundary,
    copyText,
  };
}

function buildProjectDrafts(profile) {
  const resources = profile.resources || "已有客户资源";
  const lowPressure = profile.salesComfort === "抗拒销售";
  const isCareer = profile.earningPreference === "求职涨薪";
  const isBusiness = profile.earningPreference === "小生意经营";
  const profileText = `${profile.role || ""} ${profile.skills || ""} ${profile.resources || ""}`;
  const isAiB2b = /AI|图文|视频|业务系统|系统生成|低代码/.test(profileText) && /B端|产品|售前|解决方案|招投标|业务系统|企业/.test(profileText);
  const hasContentChannel = /小红书|抖音|账号|行业拆解|粉丝/.test(resources);
  const targetCustomer = isCareer
    ? "目标岗位招聘方或潜在雇主"
    : isAiB2b
      ? "有数字化需求但缺产品/技术团队的中小企业老板"
      : resources.includes("工厂") || resources.includes("设备")
        ? "有设备搬迁/改造/采购需求的工厂客户"
        : hasContentChannel
          ? "通过内容关注行业拆解和AI应用的潜在企业客户"
          : `${resources}中的潜在付费客户`;
  const base = {
    type: isCareer ? "其他" : isBusiness ? "实体小生意" : "接单服务",
    stage: "验证",
    status: "验证中",
  };
  const firstAction = lowPressure
    ? `整理1个案例，发给3个老客户或${targetCustomer}试探反馈`
    : isAiB2b
      ? "整理1个AI业务系统案例，发布到小红书/抖音并发给3个潜在企业客户"
      : `联系3个${targetCustomer}，确认真实需求和预算`;
  const mainDraft = {
    ...base,
    name: isCareer ? "AI能力作品集求职" : isAiB2b ? "AI业务系统生成咨询" : resources.includes("工厂") || resources.includes("设备") ? "工厂设备改造咨询" : "个人能力变现服务",
    targetCustomer,
    monetization: isCareer ? "求职涨薪 / 项目制顾问机会" : isAiB2b ? "需求诊断费 / 系统原型服务费 / 方案咨询费" : resources.includes("工厂") || resources.includes("设备") ? "方案报价 / 服务费 / 产品销售" : "咨询费 / 交付服务费 / 方案费",
    nextAction: firstAction,
    riskWarning: "不要先重资产投入、囤货或承诺收益，先用真实反馈验证。",
  };
  const contentDraft = {
    ...base,
    type: "内容/IP",
    name: `${profile.role || "个人能力"}案例内容获客`,
    targetCustomer,
    monetization: "内容线索 / 咨询转化 / 服务成交",
    nextAction: `写1条面向${targetCustomer}的案例内容，观察咨询和转发反馈`,
    riskWarning: "不要只做泛内容，必须绑定目标客户和明确成交路径。",
  };
  return [mainDraft, contentDraft];
}

function uniqueList(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function shortActionText(text = "") {
  const firstClause = String(text)
    .replace(/^下一步建议：/, "")
    .split(/[，,。；;]/)[0]
    .trim();
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}...` : firstClause || "推进一个小动作";
}

function projectFromDraft(draft) {
  return {
    id: uid(),
    name: draft.name,
    type: draft.type || "接单服务",
    status: draft.status || "验证中",
    stage: draft.stage || "验证",
    targetCustomer: draft.targetCustomer || "",
    monetization: draft.monetization || "",
    nextAction: draft.nextAction || "",
    description: draft.riskWarning || "",
  };
}

function createOnboardingPlan(text, options = {}) {
  const result = parseNaturalProfile(text);
  const firstDraft = result.projectDrafts[0];
  const projects = firstDraft ? [projectFromDraft(firstDraft)] : [];
  const targetAmount = Number(options.targetAmount || 100000);
  const deadline = options.deadline || "2026-12-31";
  const goal = {
    ...structuredClone(defaultState.goal),
    targetAmount,
    initialAmount: 0,
    deadline,
    weeklyHours: result.profile.weeklyHours || defaultState.goal.weeklyHours,
    riskPreference: result.profile.riskPreference || defaultState.goal.riskPreference,
  };
  return {
    goal,
    profile: {
      ...structuredClone(defaultState.personalProfile),
      ...result.profile,
      recommendations: result.recommendations,
      projectDrafts: result.projectDrafts,
    },
    projects,
    dailyAction: {
      text: shortActionText(projects[0]?.nextAction || "记录今天的一笔收入、支出或行动"),
      projectName: projects[0]?.name || "",
      estimatedMinutes: actionMinutes(25, result.profile),
      source: projects[0] ? "AI 推荐项目" : "数据补全",
      detail: projects[0]?.nextAction || "",
      status: "pending",
    },
  };
}

function addProfileProjectDraft(index) {
  const draft = state.personalProfile?.projectDrafts?.[index];
  if (!draft) return null;
  const existing = state.projects.find((project) => project.name === draft.name);
  if (existing) {
    alert("这个推荐项目已经添加过了。");
    return existing;
  }
  const project = projectFromDraft(draft);
  state.projects.push(project);
  state.dailyAction = {
    text: shortActionText(project.nextAction || `推进 ${project.name} 的第一个客户验证`),
    projectName: project.name,
    estimatedMinutes: actionMinutes(25),
    source: "AI 推荐项目",
    detail: project.nextAction || "",
    status: "pending",
  };
  state.modal = null;
  state.activeTab = "projects";
  state.activeProjectId = project.id;
  saveState();
  render();
  return project;
}

function saveGoal() {
  state.goal = {
    ...state.goal,
    name: document.querySelector("#goalName").value.trim() || state.goal.name,
    targetAmount: Number(document.querySelector("#goalTarget").value || state.goal.targetAmount),
    initialAmount: Number(document.querySelector("#goalInitial").value || 0),
    deadline: document.querySelector("#goalDeadline").value || state.goal.deadline,
    weeklyHours: Number(document.querySelector("#goalHours").value || 0),
  };
  state.modal = null;
  saveState();
  render();
}

function saveProject() {
  const name = document.querySelector("#projectName").value.trim();
  if (!name) return;
  const data = {
    name,
    type: document.querySelector("#projectType").value,
    status: document.querySelector("#projectStatus").value,
    stage: document.querySelector("#projectStage").value,
    targetCustomer: document.querySelector("#projectTargetCustomer").value.trim(),
    monetization: document.querySelector("#projectMonetization").value.trim(),
    nextAction: document.querySelector("#projectNextAction").value.trim(),
  };
  if (state.editProjectId) {
    state.projects = state.projects.map((project) => (project.id === state.editProjectId ? { ...project, ...data } : project));
  } else {
    state.projects.push({
      id: uid(),
      ...data,
      description: "",
    });
  }
  state.modal = null;
  state.editProjectId = null;
  saveState();
  render();
}

function deleteProject() {
  const project = state.projects.find((item) => item.id === state.editProjectId);
  if (!project) return;
  if (state.projects.length <= 1) {
    alert("至少保留一个项目。");
    return;
  }
  const relatedCount = state.records.filter((record) => record.projectId === project.id).length;
  const ok = confirm(`确定删除「${project.name}」吗？关联的 ${relatedCount} 条记录也会一起删除。`);
  if (!ok) return;
  state.projects = state.projects.filter((item) => item.id !== project.id);
  state.records = state.records.filter((record) => record.projectId !== project.id);
  if (state.activeProjectId === project.id) state.activeProjectId = null;
  state.modal = null;
  state.editProjectId = null;
  state.dailyAction = generateAction();
  saveState();
  render();
}

function saveRecordEdit() {
  const recordType = document.querySelector("#recordType")?.value || "expense";
  const amount = Number(document.querySelector("#recordAmount")?.value || 0);
  const projectId = document.querySelector("#recordProjectId")?.value || "";
  const occurredAt = document.querySelector("#recordDate")?.value || todayISO();
  const note = document.querySelector("#recordNote")?.value.trim() || "无备注";
  const included = Boolean(document.querySelector("#recordIncluded")?.checked);
  state.records = state.records.map((item) =>
    item.id === state.editRecordId
      ? {
          ...item,
          recordType,
          amount: recordType === "action" ? 0 : amount,
          projectId,
          occurredAt,
          note,
          includedInGoal: recordType === "income" ? included : false,
        }
      : item,
  );
  state.modal = null;
  state.editRecordId = null;
  state.dailyAction = generateAction();
  saveState();
  render();
}

function parseRecord() {
  const input = document.querySelector("#recordText");
  const text = input?.value.trim();
  if (!text) return;
  state.recordInputText = text;
  state.recordNotice = "";
  if (riskWords.some((word) => text.includes(word))) {
    state.modal = "risk";
    render();
    return;
  }
  const drafts = parseTextToDrafts(text, state.recordProjectId);
  if (!drafts.length) {
    state.recordNotice = "这句话还没识别出收入、支出或行动。可以补充金额、项目或动作，例如“房贷支出3150”或“联系3个客户”。";
    render();
    return;
  }
  state.draftRecords = drafts;
  state.modal = "confirm";
  render();
}

function startVoiceInput() {
  const input = document.querySelector("#recordText");
  if (!input) return;
  state.recordNotice = "已定位到输入框。手机可点键盘麦克风说话；电脑可用系统听写。网页直录转文字需要后端语音服务，当前先用系统语音输入保证稳定。";
  render();
  document.querySelector("#recordText")?.focus();
}

function startCoachQuestion(question) {
  const project = getActionProject() || state.projects[0];
  state.activeTab = "record";
  state.activeProjectId = null;
  state.recordProjectId = project?.id || "";
  state.recordInputText = `AI追问：${question}\n我的回答：`;
  state.recordNotice = "回答这个问题后点 AI 识别，系统会把它保存成客户反馈/行动信号。";
  saveState();
  render();
}

function parseTextToDrafts(text, preferredProjectId = "") {
  const project = guessProject(text) || getProject(preferredProjectId);
  const clauses = text
    .split(/[，,。；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const parts = clauses.length ? clauses : [text];
  const drafts = [];

  for (const part of parts) {
    const hasMoneyIntent = /(收入|进账|赚|收款|到账|接广|成交|尾款|分成|工资|提成|回款|销售|卖|花|花费|支出|费用|付|付款|支付|投流|成本|买|购买|发了|用了|扣|扣款|亏|充值|订阅|会员|房贷|房租|水电|物业|美金|美元|usd|\$|¥|￥)/i.test(part);
    const hasActionIntent = /(联系|发布|整理|复盘|跟进|拜访|沟通|面试|投递|客户|反馈|需求|报价|案例|回答)/.test(part);
    if (!hasMoneyIntent && hasActionIntent) continue;
    const amountMatches = [...part.matchAll(/([$￥¥])?\s*(\d+(?:\.\d{1,2})?)\s*(美金|美元|刀|usd|USD|元|块|圆)?/g)].filter((match) => {
      const unit = match[3] || match[1] || "";
      const after = part.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 2);
      if (!unit && /个|位|条|次|人|家/.test(after)) return false;
      return Boolean(unit) || hasMoneyIntent;
    });
    if (!amountMatches.length) continue;
    const recordType = classifyRecordType(part);
    amountMatches.forEach((match) => {
      const rawAmount = Number(match[2]);
      const unit = match[3] || match[1] || "";
      const isUsd = /美金|美元|刀|usd|USD|\$/.test(unit);
      const amount = isUsd ? Math.round(rawAmount * USD_TO_CNY * 100) / 100 : rawAmount;
      const note = isUsd ? `${cleanNote(part)}（${rawAmount}美元，按 ${USD_TO_CNY} 折算）` : cleanNote(part);
      drafts.push({
        id: uid(),
        recordType,
        amount,
        originalAmount: rawAmount,
        currency: isUsd ? "USD" : "CNY",
        exchangeRate: isUsd ? USD_TO_CNY : 1,
        projectId: project?.id || "",
        note,
        sourceText: text,
        occurredAt: todayISO(),
        includedInGoal: recordType === "income",
        aiConfidence: 0.82,
      });
    });
  }

  if (drafts.length) return drafts;

  if (/(联系|发布|整理|复盘|跟进|沟通|客户|反馈|需求|报价|案例|AI追问|我的回答)/.test(text)) {
    return [
      {
        id: uid(),
        recordType: "action",
        amount: 0,
        actionCount: Number(text.match(/\d+/)?.[0] || 1),
        actionUnit: /反馈|需求|报价|AI追问|我的回答/.test(text) ? "次反馈" : text.includes("客户") ? "个客户" : "次",
        projectId: project?.id || "",
        note: text,
        sourceText: text,
        occurredAt: todayISO(),
        includedInGoal: false,
        aiConfidence: 0.78,
      },
    ];
  }
  return [];
}

function classifyRecordType(text) {
  const incomeWords = /(收入|进账|赚|赚了|收|收了|收款|收到|到账|接广|成交|尾款|分成|工资|提成|回款|销售|卖出|卖了|客户付|客户付款)/;
  const expenseWords = /(花|花了|花费|支出|费用|成本|付|付款|支付|投流|买|购买|发了|用了|扣|扣款|亏|充值|订阅|会员|房贷|房租|水电|物业|运费|服务费|手续费|采购|进货)/;
  const hasIncome = incomeWords.test(text);
  const hasExpense = expenseWords.test(text);
  if (hasExpense && !hasIncome) return "expense";
  if (hasIncome && !hasExpense) return "income";
  if (hasExpense && hasIncome) {
    const firstExpense = text.search(expenseWords);
    const firstIncome = text.search(incomeWords);
    return firstExpense >= 0 && firstIncome >= 0 && firstExpense < firstIncome ? "expense" : "income";
  }
  return "expense";
}

function guessProject(text) {
  return (
    state.projects.find((project) => text.includes(project.name)) ||
    state.projects.find((project) => {
      const key = project.name.replace(/产品|销售|服务|项目|运营|收入|支出/g, "").slice(0, 3);
      return key.length >= 2 && text.includes(key);
    }) ||
    null
  );
}

function cleanNote(text) {
  return text.replace(/\s+/g, " ").slice(0, 40);
}

function buildRecordCoachResponse(drafts = []) {
  const first = drafts[0] || {};
  const project = getProject(first.projectId) || state.projects[0] || {};
  const noteText = drafts.map((item) => item.note || item.sourceText || "").join(" ");
  const hasFeedback = /客户|反馈|需求|报价|案例|沟通/.test(noteText) || drafts.some((item) => item.recordType === "action");
  const hasIncome = drafts.some((item) => item.recordType === "income");
  const hasExpense = drafts.some((item) => item.recordType === "expense");
  const title = hasIncome ? "AI 读到一笔收入" : hasExpense ? "AI 读到一笔成本" : "AI 读到一条反馈";
  const summary = hasIncome
    ? `这说明「${project.name || "当前项目"}」已经出现真实付款信号，下一步要复盘来源并争取复购或转介绍。`
    : hasExpense
      ? `这是一笔成本信号。AI 建议你确认它是否服务于明确项目，避免继续投入没有反馈的成本。`
      : hasFeedback
        ? `这是一条客户反馈或真实需求信号，说明「${project.name || "当前项目"}」不只是想法，已经有可验证线索。`
        : "这条记录会成为后续 AI 判断项目优先级的依据。";
  const nextAction = hasIncome
    ? "下一步：记录付款客户来源，并整理1个复购或转介绍动作。"
    : hasExpense
      ? "下一步：标记这笔成本对应的预期回报，7天内没有反馈就暂停新增投入。"
      : /报价/.test(noteText)
        ? "下一步：把报价和案例整理成一页说明，发给这个客户验证预算。"
        : /案例/.test(noteText)
          ? "下一步：补齐案例的前后对比、交付范围和可收费版本。"
          : "下一步：把这条反馈转成一个可验证的小动作，并继续记录结果。";
  return {
    title,
    summary,
    nextAction,
    projectName: project.name || "",
  };
}

function saveDrafts() {
  const drafts = state.draftRecords.map((item) => ({
    ...item,
    id: uid(),
    createdAt: new Date().toISOString(),
    occurredAt: item.occurredAt || todayISO(),
    includedInGoal: item.recordType === "income" ? item.includedInGoal !== false : false,
  }));
  state.records.push(...drafts);
  state.lastCoachResponse = buildRecordCoachResponse(drafts);
  state.draftRecords = [];
  state.recordInputText = "";
  state.recordNotice = "";
  state.modal = null;
  state.activeTab = "home";
  state.dailyAction = generateAction();
  saveState();
  render();
}

function deleteRecord(id) {
  state.records = state.records.filter((item) => item.id !== id);
  saveState();
  render();
}

function setReviewAction(index) {
  const action = buildReview().actions[index];
  if (!action) return;
  const project = getActionProject();
  state.dailyAction = {
    text: action.text.replace(/^围绕\s+/, "").replace(/。$/, ""),
    projectName: project?.name || getStats().bestProject?.name || state.projects[0]?.name || "当前项目",
    estimatedMinutes: action.minutes || 30,
    source: action.source || "AI 周复盘",
    status: "pending",
  };
  state.activeTab = "home";
  saveState();
  render();
}

function unlockPro() {
  state.isPro = true;
  saveState();
  render();
}

function exportCsv() {
  const header = ["日期", "类型", "项目", "金额", "备注", "是否计入目标"];
  const rows = state.records.map((item) => {
    const type = item.recordType === "income" ? "收入" : item.recordType === "expense" ? "支出" : "行动";
    const project = getProject(item.projectId)?.name || "未关联项目";
    return [item.occurredAt, type, project, item.amount || "", item.note || "", item.includedInGoal ? "是" : "否"];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `亿个小目标记录_${todayISO().replaceAll("-", "")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadText(filename, text, type = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const payload = {
    product: "亿个小目标",
    version: 2,
    exportedAt: new Date().toISOString(),
    data: snapshotState(),
  };
  downloadText(`亿个小目标备份_${todayISO().replaceAll("-", "")}.json`, JSON.stringify(payload, null, 2));
}

function appendTemplateProjects() {
  const key = document.querySelector("#appendTemplate")?.value || "side";
  const template = startTemplates[key] || startTemplates.side;
  const existingNames = new Set(state.projects.map((project) => project.name));
  const additions = template.projects
    .filter(([name]) => !existingNames.has(name))
    .map(([name, type]) => ({
      id: uid(),
      name,
      type,
      status: "验证中",
      description: "",
    }));
  if (!additions.length) {
    alert("这个模板里的项目已经添加过了。");
    return;
  }
  state.projects.push(...additions);
  saveState();
  alert(`已添加 ${additions.length} 个项目。`);
  render();
}

function importBackupFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      const data = payload.data || payload;
      if (!data.goal || !Array.isArray(data.projects) || !Array.isArray(data.records)) {
        alert("备份文件格式不正确。");
        return;
      }
      applySnapshot(data);
      saveState();
      alert("导入成功。");
      render();
    } catch (error) {
      alert(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function getResetBackup() {
  try {
    const payload = JSON.parse(localStorage.getItem(RESET_BACKUP_KEY) || "null");
    if (!payload?.data?.goal || !Array.isArray(payload.data.projects) || !Array.isArray(payload.data.records)) return null;
    return payload;
  } catch {
    return null;
  }
}

function resetAppData() {
  const ok = confirm("重新开始会清空当前目标、项目和记录。系统会先保存一份本机恢复备份，仍然建议你先导出完整备份。确定继续吗？");
  if (!ok) return;
  localStorage.setItem(
    RESET_BACKUP_KEY,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      data: snapshotState(),
    }),
  );
  state = structuredClone(defaultState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, modal: null, draftRecords: [], editRecordId: null }));
  queueCloudSave();
  alert("已重新开始。本机已保留一份恢复备份，可在“我的”里恢复。");
  render();
}

function restoreResetBackup() {
  const backup = getResetBackup();
  if (!backup) {
    alert("没有找到可恢复的数据。");
    return;
  }
  const ok = confirm("确定恢复到上次重新开始前的数据吗？当前未备份的数据会被覆盖。");
  if (!ok) return;
  applySnapshot(backup.data);
  saveState();
  alert("已恢复上次重新开始前的数据。");
  render();
}

async function copyShareLink() {
  const url = "https://sabina86589089.github.io/yigexiaomubiao/";
  try {
    await navigator.clipboard.writeText(url);
    alert("已复制分享链接。");
  } catch {
    prompt("复制这个链接发给朋友：", url);
  }
}

async function copyProfileShareText() {
  const text = buildProfileShareText(state.personalProfile, state.projects);
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制画像分享文案。");
  } catch {
    prompt("复制这段画像文案：", text);
  }
}

async function copyPaidDiagnosisReport() {
  const text = buildPaidDiagnosisReport().copyText;
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制付费诊断报告。");
  } catch {
    prompt("复制这份诊断报告：", text);
  }
}

async function copyPurchaseGuide() {
  const report = buildPaidDiagnosisReport();
  const text = [
    `${report.title}｜${report.priceLabel}`,
    "",
    report.valuePromise,
    report.limitedOffer,
    "",
    "你会拿到：",
    ...report.deliverables.map((item) => `- ${item}`),
    "",
    "购买流程：",
    ...report.purchaseSteps.map((item) => `- ${item}`),
    "",
    "下单资料模板：",
    report.orderTemplate,
    "",
    report.payment.copy,
    "",
    report.boundary,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制购买说明。");
  } catch {
    prompt("复制这段购买说明：", text);
  }
}

async function copyOrderTemplate() {
  const text = buildPaidDiagnosisReport().orderTemplate;
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制下单资料模板。");
  } catch {
    prompt("复制这段下单资料：", text);
  }
}

async function copySelfIntroText() {
  const text = buildSelfIntroText(state.personalProfile, state.projects);
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制自我介绍。");
  } catch {
    prompt("复制这段自我介绍：", text);
  }
}

async function copyContentPackText() {
  const pack = buildContentStarterPack(state.personalProfile, state.projects);
  const text = [
    "我的首批内容选题：",
    "",
    ...pack.topics.flatMap((item, index) => [
      `${index + 1}. ${item.title}`,
      `开头：${item.hook}`,
      `结构：${item.outline.join(" / ")}`,
      "",
    ]),
    "自我介绍：",
    pack.intro,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制内容选题。");
  } catch {
    prompt("复制这组选题：", text);
  }
}

function sendFeedback() {
  const subject = encodeURIComponent("亿个小目标内测反馈");
  const body = encodeURIComponent(
    `我在使用亿个小目标时的反馈：\n\n1. 最有用的地方：\n\n2. 最卡的地方：\n\n3. 我希望增加：\n\n当前记录数：${state.records.length}\n项目数：${state.projects.length}`,
  );
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function completeAction() {
  state.dailyAction.status = "completed";
  saveState();
  render();
}

function refreshAction() {
  state.dailyAction = generateAction();
  saveState();
  render();
}

function actionMinutes(baseMinutes, profile = state.personalProfile || {}) {
  const hours = Number(profile.weeklyHours || state.goal.weeklyHours || 8);
  if (hours <= 5) return Math.min(baseMinutes, 25);
  if (hours >= 15) return Math.max(baseMinutes, 35);
  return baseMinutes;
}

function getActionProject(stats = getStats()) {
  const candidates = stats.projectStats.length ? stats.projectStats : state.projects;
  const withNextAction = candidates.find((project) => project.nextAction && project.status !== "已结束");
  if (withNextAction) return withNextAction;
  const profitable = candidates.find((project) => project.weekNet > 0);
  return profitable || stats.bestProject || candidates[0] || null;
}

function buildActionOptions(project, profile = state.personalProfile || {}, stats = getStats()) {
  const projectName = project?.name || "当前项目";
  const customer = project?.targetCustomer || "潜在客户";
  const options = [];
  if (project?.nextAction) {
    options.push({ text: project.nextAction, minutes: actionMinutes(25, profile), source: "项目下一步" });
  }
  if (profile.salesComfort === "抗拒销售") {
    options.push({
      text: `整理 1 个${projectName}的案例，发给熟人或老客户试探反馈`,
      minutes: actionMinutes(25, profile),
      source: "个人画像",
    });
  } else {
    options.push({
      text: `联系 3 个${customer}，验证${projectName}的真实需求`,
      minutes: actionMinutes(30, profile),
      source: "项目画像",
    });
  }
  options.push(
    { text: `整理 1 个${projectName}的成交或交付案例`, minutes: actionMinutes(25, profile), source: "项目复盘" },
    { text: `发布 1 条面向${customer}的成果内容`, minutes: actionMinutes(40, profile), source: "获客动作" },
  );
  if (stats.weekExpense > 0 || stats.weekNet < 0) {
    options.push({ text: "复盘本周最大一笔支出，判断是否继续投入", minutes: actionMinutes(20, profile), source: "成本控制" });
  }
  options.push({ text: "记录今天的一笔收入、支出或行动", minutes: 10, source: "数据补全" });
  return options;
}

function generateAction() {
  const stats = getStats();
  const best = getActionProject(stats);
  const actions = buildActionOptions(best, state.personalProfile, stats);
  const pick = actions[0];
  return {
    text: shortActionText(pick.text),
    projectName: best?.name || "当前项目",
    estimatedMinutes: pick.minutes,
    source: pick.source,
    detail: pick.text,
    status: "pending",
  };
}

initCloud();
