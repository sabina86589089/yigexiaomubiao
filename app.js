const STORAGE_KEY = "small-goals-v1";

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
  recordNotice: "",
  desktopMode: false,
  isPro: false,
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
      <div class="button-row">
        <button class="primary-btn" data-action="complete-action">${state.dailyAction.status === "completed" ? "已完成" : "完成"}</button>
        <button class="secondary-btn" data-action="refresh-action">换一个</button>
      </div>
    </section>

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

function renderRecordPage() {
  const records = [...state.records].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return `
    ${renderTopbar("记录进展", "10 秒记一笔")}
    <section class="card">
      <div class="form">
        <div class="field">
          <label>今天发生了什么？</label>
          <textarea id="recordText" placeholder="例如：今天小红书接广收入 800，投流花了 120">${state.recordInputText || ""}</textarea>
        </div>
        <div class="chips">
          <button class="chip" data-example="今天小红书接广收入 800">收入 800</button>
          <button class="chip" data-example="视频号投流花了 120">支出 120</button>
          <button class="chip" data-example="联系了 3 个潜在客户">联系 3 个客户</button>
        </div>
        <div class="button-row">
          <button class="secondary-btn" data-action="voice-input">语音输入</button>
          <button class="primary-btn" data-action="parse-record">AI 识别</button>
        </div>
        ${state.recordNotice ? `<div class="notice auth-error">${state.recordNotice}</div>` : ""}
        <div class="notice">提示：没有明确提到项目时，会先归为“未关联”，你可以在确认卡里选择项目。</div>
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
          <div class="project-meta">${project.type} · ${project.status}</div>
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
        <ul>${review.actions.map((item, index) => `<li>${item} <button class="text-btn" data-set-action="${index}">设为今日行动</button></li>`).join("")}</ul>
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
  const summary = `本周你共记录 ${getWeekRecords().length} 次，收入 ${money(stats.weekIncome)}，支出 ${money(stats.weekExpense)}，净收益 ${money(stats.weekNet)}。`;
  const bestText = best
    ? `${best.name} 本周净收益 ${money(best.weekNet)}。如果这个收入来自少数订单，建议继续验证复购和转介绍。`
    : "记录还不够多，暂时无法判断最佳项目。";
  const watchText =
    watch && watch.weekNet < 0
      ? `${watch.name} 本周净收益为 ${money(watch.weekNet)}。建议先复盘成本来源，暂停无明确回报的新增投入。`
      : "暂时没有明显亏损项目，但样本量有限，继续记录一周会更准确。";
  const projectName = best?.name || state.projects[0]?.name || "当前项目";
  return {
    summary,
    best: bestText,
    watch: watchText,
    actions: [
      `围绕 ${projectName} 联系 3 个潜在客户或相似品牌。`,
      "整理 1 个最近的成交案例，发布成内容或发给客户。",
      "复盘本周支出，标记一项可以暂停的低效成本。",
    ],
  };
}

function renderMePage() {
  return `
    ${renderTopbar("我的", "设置与内测")}
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
  return `
    <main class="onboarding">
      <section class="card">
        <div class="brand">亿</div>
        <div class="eyebrow">AI 赚钱目标作战台</div>
        <h1 class="title">先设一个你想盯住的赚钱目标</h1>
        <p class="hero-sub">我们帮你记录进展、复盘项目，并生成下一步行动参考。</p>
        <div class="form section">
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
          <div class="field">
            <label>当前已完成</label>
            <input id="onboardInitial" type="number" value="0" min="0" />
          </div>
          <div class="field">
            <label>起步模板</label>
            <select id="onboardTemplate">
              ${Object.entries(startTemplates).map(([key, item]) => `<option value="${key}" ${key === "blank" ? "selected" : ""}>${item.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>第一个项目名称</label>
            <input id="onboardProject" placeholder="可以先不填，之后在项目页添加" />
          </div>
          <button class="primary-btn" data-action="finish-onboarding">开始我的作战台</button>
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
  if (state.modal === "project") return renderProjectModal();
  if (state.modal === "record") return renderRecordModal();
  if (state.modal === "confirm") return renderConfirmModal();
  if (state.modal === "risk") return renderRiskModal();
  return "";
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
                  <div class="field"><label>金额</label><input type="number" data-draft="${index}" data-field="amount" value="${item.amount || 0}" /></div>
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

  const recordText = document.querySelector("#recordText");
  if (recordText) {
    recordText.addEventListener("input", () => {
      state.recordInputText = recordText.value;
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
  if (action === "send-feedback") sendFeedback();
  if (action === "back-projects") {
    state.activeProjectId = null;
    render();
  }
  if (action === "reset-demo") {
    localStorage.removeItem(STORAGE_KEY);
    state = structuredClone(defaultState);
    render();
  }
}

function finishOnboarding() {
  const target = Number(document.querySelector("#onboardTarget").value || 1000000);
  const deadline = document.querySelector("#onboardDeadline").value || "2026-12-31";
  const initial = Number(document.querySelector("#onboardInitial").value || 0);
  const projectName = document.querySelector("#onboardProject").value.trim();
  const templateKey = document.querySelector("#onboardTemplate")?.value || "side";
  const template = startTemplates[templateKey] || startTemplates.side;
  const projects =
    templateKey === "blank" && !projectName
      ? []
      : template.projects.map(([name, type], index) => ({
          id: uid(),
          name: index === 0 && projectName ? projectName : name,
          type,
          status: "验证中",
          description: "",
        }));
  state.hasOnboarded = true;
  state.goal = { ...state.goal, targetAmount: target, initialAmount: initial, deadline };
  state.projects = projects;
  state.records = [];
  state.dailyAction = {
    text: "记录今天的一笔收入、支出或行动",
    projectName: projects[0]?.name || "",
    estimatedMinutes: 10,
    status: "pending",
  };
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
  const drafts = parseTextToDrafts(text);
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
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  input.focus();

  if (!SpeechRecognition) {
    alert("当前浏览器不支持网页语音识别。可以点输入框后使用微信/系统键盘上的麦克风语音输入。");
    return;
  }

  const button = document.querySelector('[data-action="voice-input"]');
  const originalText = button?.textContent || "语音输入";
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (button) button.textContent = "正在听...";
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join("")
      .trim();
    if (!transcript) return;
    const prefix = input.value.trim();
    input.value = prefix ? `${prefix}，${transcript}` : transcript;
    state.recordInputText = input.value;
    state.recordNotice = "";
    input.focus();
  };

  recognition.onerror = () => {
    alert("语音识别没有成功。可以再试一次，或使用微信/系统键盘麦克风输入。");
  };

  recognition.onend = () => {
    if (button) button.textContent = originalText;
  };

  recognition.start();
}

function parseTextToDrafts(text) {
  const project = guessProject(text);
  const clauses = text
    .split(/[，,。；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const parts = clauses.length ? clauses : [text];
  const drafts = [];

  for (const part of parts) {
    const hasMoneyIntent = /(收入|进账|赚|收款|到账|接广|成交|尾款|分成|花|支出|付|投流|成本|买|发了|用了|扣|亏|充值|房贷|美金|美元|usd|\$|¥|￥)/i.test(part);
    const hasActionIntent = /(联系|发布|整理|复盘|跟进|拜访|沟通|面试|投递|客户)/.test(part);
    if (!hasMoneyIntent && hasActionIntent) continue;
    const amountMatches = [...part.matchAll(/([$￥¥])?\s*(\d+(?:\.\d{1,2})?)\s*(美金|美元|刀|usd|USD|元|块|圆)?/g)].filter((match) => {
      const unit = match[3] || match[1] || "";
      const after = part.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 2);
      if (!unit && /个|位|条|次|人|家/.test(after)) return false;
      return Boolean(unit) || hasMoneyIntent;
    });
    if (!amountMatches.length) continue;
    const isExpense = /(花|支出|付|投流|成本|买|发了|用了|扣|亏)/.test(part);
    const isIncome = /(收入|进账|赚|收款|到账|接广|成交|尾款|分成)/.test(part);
    amountMatches.forEach((match) => {
      const rawAmount = Number(match[2]);
      const unit = match[3] || match[1] || "";
      const isUsd = /美金|美元|刀|usd|USD|\$/.test(unit);
      const amount = isUsd ? Math.round(rawAmount * USD_TO_CNY * 100) / 100 : rawAmount;
      const note = isUsd ? `${cleanNote(part)}（${rawAmount}美元，按 ${USD_TO_CNY} 折算）` : cleanNote(part);
      drafts.push({
        id: uid(),
        recordType: isExpense && !isIncome ? "expense" : "income",
        amount,
        originalAmount: rawAmount,
        currency: isUsd ? "USD" : "CNY",
        exchangeRate: isUsd ? USD_TO_CNY : 1,
        projectId: project?.id || "",
        note,
        sourceText: text,
        occurredAt: todayISO(),
        includedInGoal: !(isExpense && !isIncome),
        aiConfidence: 0.82,
      });
    });
  }

  if (drafts.length) return drafts;

  if (/(联系|发布|整理|复盘|跟进)/.test(text)) {
    return [
      {
        id: uid(),
        recordType: "action",
        amount: 0,
        actionCount: Number(text.match(/\d+/)?.[0] || 1),
        actionUnit: text.includes("客户") ? "个客户" : "次",
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

function saveDrafts() {
  const drafts = state.draftRecords.map((item) => ({
    ...item,
    id: uid(),
    createdAt: new Date().toISOString(),
    occurredAt: item.occurredAt || todayISO(),
    includedInGoal: item.recordType === "income" ? item.includedInGoal !== false : false,
  }));
  state.records.push(...drafts);
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
  state.dailyAction = {
    text: action.replace(/^围绕\s+/, "").replace(/。$/, ""),
    projectName: getStats().bestProject?.name || state.projects[0]?.name || "当前项目",
    estimatedMinutes: 30,
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

async function copyShareLink() {
  const url = "https://sabina86589089.github.io/yigexiaomubiao/";
  try {
    await navigator.clipboard.writeText(url);
    alert("已复制分享链接。");
  } catch {
    prompt("复制这个链接发给朋友：", url);
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

function generateAction() {
  const stats = getStats();
  const best = stats.bestProject || state.projects[0];
  const actions = [
    { text: `联系 3 个和${best?.name || "当前项目"}相关的潜在客户`, minutes: 30 },
    { text: "整理 1 个最近的成交案例", minutes: 25 },
    { text: "发布 1 条展示成果的内容", minutes: 40 },
    { text: "复盘本周最大一笔支出", minutes: 20 },
    { text: "记录今天的一笔收入、支出或行动", minutes: 10 },
  ];
  const pick = actions[Math.floor(Math.random() * actions.length)];
  return {
    text: pick.text,
    projectName: best?.name || "当前项目",
    estimatedMinutes: pick.minutes,
    status: "pending",
  };
}

initCloud();
