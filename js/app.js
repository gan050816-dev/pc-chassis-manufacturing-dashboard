/**
 * 生产工序监控看板 - 核心逻辑 (Deep Dive Version)
 */

// 模拟配置
const CONFIG = {
    updateInterval: 1000,
    isRunning: true,
    productionRate: 3,
    defectRate: 0.02
};

// 初始数据状态 (Main Dashboard)
const processState = {
    gx002: { produced: 1240, defects: 12, speed: 450, cycle: 8.0 }, // Speed pcs/h
    gx004: { produced: 1180, defects: 8, speed: 440, cycle: 8.2 },
    gx005: { produced: 1150, defects: 5, speed: 420, cycle: 8.5 },
    gx006: { produced: 1120, defects: 2, speed: 410, cycle: 8.8 },
    gx007: { produced: 1090, defects: 1, speed: 430, cycle: 8.3 }
};

// 详细视图静态配置 & 动态初始值
const processDetails = {
    gx002: {
        name: "GX002 冲压", manager: "张伟",
        machines: [
            { name: "冲压机 #1", params: { "冲次(SPM)": 45, "合模力(T)": 120, "模具寿命": "88%" } },
            { name: "冲压机 #2", params: { "冲次(SPM)": 44, "合模力(T)": 121, "模具寿命": "92%" } },
            { name: "冲压机 #3", params: { "冲次(SPM)": 0, "合模力(T)": 0, "模具寿命": "休止" }, status: "stopped" }
        ],
        protocol: {
            field: ["PLC (Siemens)", "压力传感器"],
            type: "自动采集 (Auto)",
            proto: "Modbus TCP / Profinet"
        }
    },
    gx004: {
        name: "GX004 喷涂", manager: "李四",
        machines: [
            { name: "喷涂臂 A", params: { "涂料流量(ml/s)": 240, "雾化压力(bar)": 3.5 } },
            { name: "喷涂臂 B", params: { "涂料流量(ml/s)": 242, "雾化压力(bar)": 3.4 } },
            { name: "烘干炉", params: { "当前温度(℃)": 180, "设定温度(℃)": 180 } }
        ],
        protocol: {
            field: ["智能传感器", "流量计"],
            type: "自动采集 (Auto)",
            proto: "Analog (4-20mA) / IO-Link"
        }
    },
    gx005: {
        name: "GX005 组装", manager: "王五",
        machines: [
            { name: "工位 01", params: { "拧紧扭矩(Nm)": 12.5, "扫码": "OK", "CT(s)": 22 } },
            { name: "工位 02", params: { "拧紧扭矩(Nm)": 12.4, "扫码": "OK", "CT(s)": 23 } },
            { name: "工位 03", params: { "拧紧扭矩(Nm)": 12.5, "扫码": "--", "CT(s)": 0 }, status: "idle" }
        ],
        protocol: {
            field: ["智能电批", "扫码枪"],
            type: "半自动采集 (Semi)",
            proto: "OpenProtocol / TCP/IP"
        }
    },
    gx006: {
        name: "GX006 质检", manager: "赵六",
        machines: [
            { name: "视觉检测 A", params: { "FPS": 60, "良品": 998, "NG": 2 } },
            { name: "视觉检测 B", params: { "FPS": 60, "良品": 1002, "NG": 1 } },
            { name: "人工复检", params: { "复检数": 3, "确认为良": 2 } }
        ],
        protocol: {
            field: ["工业相机", "人工终端"],
            type: "自动/人工混合",
            proto: "MQTT / TCP/IP"
        }
    },
    gx007: {
        name: "GX007 包装", manager: "孙七",
        machines: [
            { name: "自动封箱机", params: { "封箱度": "OK", "计数": 4502 } },
            { name: "电子称重台", params: { "当前重量(kg)": 12.5, "标准(kg)": 12.5 } },
            { name: "贴标机", params: { "标签余量": "45%" } }
        ],
        protocol: {
            field: ["RFID 读写器", "电子秤"],
            type: "自动采集 (Auto)",
            proto: "RS485 / Modbus RTU"
        }
    }
};

let currentModalId = null;

// Global Metrics State
const globalState = {
    oee: 85, quality: 99.2,
    wip: { gx002: 50, gx004: 120, gx005: 80, gx006: 30, gx007: 10 },
    chartData: Array(10).fill(0).map((_, i) => ({ hour: 8 + i, plan: 500 * (i + 1), actual: 480 * (i + 1) }))
};

// DOM Refs
const dom = {
    time: document.getElementById('current-time'),
    toggleBtn: document.getElementById('toggle-btn'),
    statusBadge: document.getElementById('system-status'),
    modal: document.getElementById('detail-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalManager: document.getElementById('modal-manager'),
    machineList: document.getElementById('machine-list'),
    fieldLayer: document.getElementById('field-layer'),
    colType: document.getElementById('collection-type'),
    protoTag: document.getElementById('protocol-tag'),
    protoName: document.getElementById('protocol-name')
};

// --- Control Logic ---
function toggleSystem() {
    CONFIG.isRunning = !CONFIG.isRunning;
    if (CONFIG.isRunning) {
        dom.statusBadge.textContent = "产线运行中";
        dom.statusBadge.className = "status-badge running";
        dom.toggleBtn.innerHTML = '<span class="icon">⏸</span> 停止产线';
        dom.toggleBtn.className = "control-btn stop";
        document.body.classList.remove('is-paused');
    } else {
        dom.statusBadge.textContent = "产线已停止";
        dom.statusBadge.className = "status-badge stopped";
        dom.toggleBtn.innerHTML = '<span class="icon">▶</span> 启动产线';
        dom.toggleBtn.className = "control-btn start";
        document.body.classList.add('is-paused');
    }
}

// --- Data Simulation ---
function updateData() {
    if (!CONFIG.isRunning) return;

    // 1. Main Process Data
    Object.keys(processState).forEach(key => {
        const s = processState[key];
        if (Math.random() > 0.3) {
            s.produced += Math.floor(Math.random() * CONFIG.productionRate);
            if (Math.random() < CONFIG.defectRate) s.defects++;
        }
        // Speed & Cycle fluctuation
        s.speed = Math.floor(400 + Math.random() * 100);
        s.cycle = (3600 / s.speed).toFixed(1);
    });

    // 2. Global Metrics
    globalState.oee = Math.min(99, Math.max(70, globalState.oee + (Math.random() - 0.5)));

    // 3. Modal Data Simulation (if open)
    if (currentModalId) {
        const details = processDetails[currentModalId];
        details.machines.forEach(m => {
            if (m.status === 'stopped') return;
            // Fluctuate numeric params
            Object.keys(m.params).forEach(p => {
                if (typeof m.params[p] === 'number') {
                    // Small fluctuation
                    const delta = (Math.random() - 0.5) * (m.params[p] * 0.05);
                    if (p.includes('冲次') || p.includes('计数') || p.includes('良品')) {
                        m.params[p] += Math.random() > 0.5 ? 1 : 0; // Increment counters
                    } else {
                        m.params[p] += delta;
                    }
                    if (p.includes('寿命') || p.includes('百分比')) {
                        // keep formatted strings separate if needed, but here simple numbers
                    }
                }
            });
        });
        renderModalContent(currentModalId);
    }

    renderCards();
    renderLowerDashboard();
}

// --- Rendering ---
function renderCards() {
    Object.keys(processState).forEach(key => {
        const s = processState[key];
        const card = document.getElementById(key);
        if (!card) return;

        card.querySelector('[data-type="produced"]').textContent = s.produced.toLocaleString();
        card.querySelector('[data-type="defects"]').textContent = s.defects;
        card.querySelector('[data-type="speed"]').textContent = s.speed; // New metric
        card.querySelector('[data-type="cycle"]').textContent = s.cycle + 's';

        // Rate
        const rate = s.produced > 0 ? ((s.produced - s.defects) / s.produced * 100).toFixed(2) : 100;
        const rateEl = card.querySelector('[data-type="rate"]');
        rateEl.textContent = rate + '%';
        rateEl.style.color = rate < 98 ? '#da3633' : '#e6edf3';
    });
}

function renderLowerDashboard() {
    // Reuse previous gauge/chart logic (Simplified for length)
    document.getElementById('oee-value').textContent = globalState.oee.toFixed(1) + '%';
    document.getElementById('oee-gauge').style.setProperty('--percent', globalState.oee);

    // WIP Chart
    const wipChart = document.getElementById('wip-chart');
    wipChart.innerHTML = '';
    Object.entries(globalState.wip).forEach(([k, v]) => {
        wipChart.innerHTML += `
            <div class="wip-row">
                <span style="width:50px">${k.toUpperCase()}</span>
                <div class="wip-bar-track"><div class="wip-bar-fill" style="width:${Math.min(100, v / 2)}%"></div></div>
                <span style="width:30px;text-align:right">${v}</span>
            </div>`;
    });
}

// --- Modal Logic ---
window.openModal = function (id) {
    currentModalId = id;
    const data = processDetails[id];
    dom.modalTitle.textContent = data.name;
    dom.modalManager.textContent = `负责人: ${data.manager}`;
    renderModalContent(id);
    dom.modal.classList.add('active');
};

window.closeModal = function () {
    dom.modal.classList.remove('active');
    currentModalId = null;
};

// Render detail content
function renderModalContent(id) {
    const data = processDetails[id];

    // 1. Machine List
    dom.machineList.innerHTML = data.machines.map(m => `
        <div class="machine-card">
            <div class="m-name">${m.name}</div>
            <div class="m-params">
                ${Object.entries(m.params).map(([k, v]) => `
                    <span>${k}: <span class="m-param-val">${typeof v === 'number' ? v.toFixed(1) : v}</span></span>
                `).join('')}
            </div>
            <div class="m-status">
                <span class="status-badge ${m.status === 'stopped' ? 'stopped' : 'running'}">
                    ${m.status === 'stopped' ? '停止' : '运行'}
                </span>
            </div>
        </div>
    `).join('');

    // 2. Protocol Arch
    dom.fieldLayer.innerHTML = data.protocol.field.map(f => `<span>📦 ${f}</span>`).join('');
    dom.colType.textContent = data.protocol.type;
    dom.protoTag.textContent = data.protocol.proto.split('/')[0];
    dom.protoName.textContent = data.protocol.proto;
}

// Init
dom.toggleBtn.addEventListener('click', toggleSystem);

// Initial Render used for chart bars structure (omitted for brevity, same as previous)
const prodChart = document.getElementById('production-chart');
globalState.chartData.forEach(d => {
    prodChart.innerHTML += `
        <div class="bar-group">
            <div class="chart-bar plan" style="height:${d.plan / 20}px"></div>
            <div class="chart-bar actual" style="height:${d.actual / 20}px"></div>
        </div>`;
});

setInterval(() => {
    document.getElementById('current-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
}, 1000);

setInterval(updateData, CONFIG.updateInterval);
renderCards();
