/* =====================================================================
 * 装备浮窗 - 魔兽世界风格 17 槽人物装备系统
 * =====================================================================
 *  17 槽: 头/颈/肩/披风/胸/护腕/手套/腰带/腿/鞋/戒指×2/饰品×2/主手/副手/远程
 *  数据: data/loot_db.json  (description 决定槽位, #h# / #w# / #s# / #a#)
 *        data/items_db.json (含 tooltip html)
 *
 *  双手武器规则 (经典 WoW):
 *    - #h2# 双手 / #w7#长柄 / #w9#法杖 / #w15#长矛
 *    - 装备双手 -> 主手, 自动卸下副手
 *    - 装备副手 (盾/单手) -> 若主手有双手, 自动卸下主手
 *
 *  远程槽: / #w2#弓 / #w3#弩 / #w5#枪 /飞刀(#w11#)/魔杖(#w12#)
 * ===================================================================== */

(function () {
  'use strict';

  // 17 槽位定义 - 按 eq.jpg 布局
  // side: L 左侧 (人物身体) / R 右侧 (人物配饰) / B 底部 (武器横排)
  // row:  在 L/R 列中的行号, B 类不需要
  // 关键布局 (与 eq.jpg 一致):
  //   L 列 11 行: 头 颈 肩 胸 | (中间 2 行空出, 显示角色立绘) | 护腕 手套 腰带 腿 鞋
  //   R 列 5 行, 顶部对齐: 披风 戒指1 戒指2 饰品1 饰品2
  //   B 底部 3 格横排: 主手 副手 远程
  const SLOTS = [
    // ===== L 列: 身体 (8 行) =====
    { key: 'head',     name: '头',     side: 'L', row: 0  },
    { key: 'neck',     name: '项链',   side: 'L', row: 1  },
    { key: 'shoulder', name: '肩',     side: 'L', row: 2  },
    { key: 'back',     name: '披风',   side: 'L', row: 3 },
    { key: 'chest',    name: '胸',     side: 'L', row: 4  },
     { key: 'wrist',    name: '护腕',   side: 'L', row: 5  },
   
    { key: 'hands',    name: '手套',   side: 'R', row: 0  },
    { key: 'waist',    name: '腰带',   side: 'R', row: 1  },
    { key: 'legs',     name: '腿',     side: 'R', row: 2  },
    { key: 'feet',     name: '鞋',     side: 'R', row: 3 },
    
    { key: 'finger1',  name: '戒指1',  side: 'R', row: 4 },
    { key: 'finger2',  name: '戒指2',  side: 'R', row: 5 },
    { key: 'trinket1', name: '饰品1',  side: 'R', row: 6 },
    { key: 'trinket2', name: '饰品2',  side: 'R', row: 7 },
    // ===== B 底部: 武器 (3 格横排) =====
    { key: 'mainhand', name: '主手',   side: 'B' },
    { key: 'offhand',  name: '副手',   side: 'B' },
    { key: 'ranged',   name: '远程',   side: 'B' }
  ];

  const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s => [s.key, s]));

  // 中文槽位标签 (参照 eq.png 右侧列表)
  const SLOT_LABEL_CN = {
    head:     '头部',
    neck:     '颈部',
    shoulder: '肩部',
    chest:    '胸部',
    back:     '背部',
    waist:    '腹部',
    legs:     '腿部',
    feet:     '脚部',
    wrist:    '手腕',
    hands:    '手部',
    finger1:  '手指',
    finger2:  '手指',
    trinket1: '饰品',
    trinket2: '饰品',
    mainhand: '主手',
    offhand:  '副手',
    ranged:   '远程'
  };

  // 右侧列表显示顺序 (与 eq.png 截图一致)
  const SLOT_DISPLAY_ORDER = [
    'head', 'neck', 'shoulder', 'chest',
    'waist', 'legs', 'feet',
    'wrist', 'hands',
    'finger1', 'finger2',
    'trinket1', 'trinket2',
    'back',
    'mainhand', 'offhand', 'ranged'
  ];

  const STORAGE_KEY = 'tw_equip_loadouts_v2';
  const PANEL_STATE_KEY = 'tw_equip_panel_state_v2';

  const state = {
    itemsDb: {},
    descById: {},        // itemId(String) -> description 串 (从 loot_db.json 抽取)
    recipesById: {},     // recipeId(String) -> { craftItemId, name, ... } (装备只能用 craftItemId)
    sourceById: {},      // itemId(String) -> { type:'profession'|'boss', label, ... } (tooltip 展示来源)
    loadouts: { '默认': { name: '默认', slots: {} } },
    loadoutOrder: ['默认'],
    currentLoadout: '默认',
    panel: { collapsed: false, x: null, y: null }
  };

  let panelEl, ctxMenuEl, equipTooltipEl, compareTooltipEl;
  let tooltipTimer = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let currentHoveredPageItem = null;
  let compareTrackRAF = 0;        // 对比 tooltip 跟随原 tooltip 的 RAF 句柄
  let compareTrackMode = 'mouse'; // 'mouse' 跟随鼠标 | 'anchor' 跟随原 tooltip | 'static' 固定
  const lastMouse = { x: null, y: null };

  // 全局记录鼠标位置, 用于对比 tooltip 跟随
  document.addEventListener('mousemove', e => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  }, { passive: true });

  // -------- Utils --------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function iconUrl(name) {
    if (!name) return 'icons/inv_misc_questionmark.png';
    const last = name.includes('\\') ? name.split('\\').pop() : name;
    return 'icons/' + last.toLowerCase() + '.png';
  }
  function qualityColor(q) {
    return ({ 0: '#9d9d9d', 1: '#fff', 2: '#1eff00', 3: '#0070dd',
              4: '#a335ee', 5: '#ff8000', 6: '#e6cc80' })[+q] || '#fff';
  }
  function qualityGlow(q) {
    return ({ 0: 'transparent', 2: 'rgba(30,255,0,0.3)', 3: 'rgba(0,112,221,0.3)',
              4: 'rgba(163,53,238,0.3)', 5: 'rgba(255,128,0,0.3)', 6: 'rgba(230,204,128,0.3)'
            })[+q] || 'transparent';
  }
  function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function cssEscape(s) {
    return String(s).replace(/(["'\\\.#:>+~*\(\)\[\]{}$^|/])/g, '\\$1');
  }

  // 从物品 tooltip html 中提取等级
  // 优先 "物品等级 N" (iLvl), 其次 "需要等级 N" (reqLevel)
  function parseItemLevel(item) {
    if (!item) return '';
    if (item.level != null) return item.level;
    const html = item.html || '';
    let m = html.match(/物品等级\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = html.match(/需要等级\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return '';
  }

  // -------- 装备属性解析/聚合 --------
  // 解析单件装备 html, 提取所有累加属性
  function parseItemStats(item) {
    const s = {
      strength: 0, agility: 0, stamina: 0, intellect: 0, spirit: 0,
      armor: 0,
      damageMin: 0, damageMax: 0, speed: 0,
      attackPower: 0,
      crit: 0, hit: 0, haste: 0,
      defense: 0, dodge: 0, parry: 0, blockValue: 0, blockChance: 0,
      spellPower: 0, healPower: 0, spellCrit: 0, spellHit: 0, manaPer5: 0
    };
    if (!item || !item.html) return s;
    const h = item.html;

    // 主属性: +N 力量/敏捷/耐力/智力/精神 (在 line 区段)
    const statMap = { '力量': 'strength', '敏捷': 'agility', '耐力': 'stamina',
                      '智力': 'intellect', '精神': 'spirit' };
    const lineAttrRe = /<div class="turtledb-item-tooltip-line">\s*\+(\d+)\s*(力量|敏捷|耐力|智力|精神)\s*<\/div>/g;
    let m;
    while ((m = lineAttrRe.exec(h)) !== null) {
      s[statMap[m[2]]] += parseInt(m[1], 10);
    }

    // 护甲值 (line: "N 点护甲")
    m = h.match(/<div class="turtledb-item-tooltip-line">\s*(\d+)\s*点护甲\s*<\/div>/);
    if (m) s.armor += parseInt(m[1], 10);

    // 武器伤害/速度: 位于 <table class="turtledb-item-tooltip-pair"><tr><td>N - N 伤害</td><th>速度 X</th></tr></table>
          // 也支持 <div class="turtledb-item-tooltip-line">N - N 伤害</div> 写法
          m = h.match(/<td>\s*(\d+)\s*-\s*(\d+)\s*伤害\s*<\/td>/)
            || h.match(/<div class="turtledb-item-tooltip-line">\s*(\d+)\s*-\s*(\d+)\s*伤害\s*<\/div>/);
          if (m) {
            s.damageMin += parseInt(m[1], 10);
            s.damageMax += parseInt(m[2], 10);
          }
          m = h.match(/<th>\s*速度\s*([\d.]+)\s*<\/th>/)
            || h.match(/<div class="turtledb-item-tooltip-line">\s*速度\s*([\d.]+)\s*<\/div>/);
          if (m) s.speed = parseFloat(m[1]); // 取主手速度 (覆盖式)

    // 盾牌格挡值 (line: "N 格挡")
    m = h.match(/<div class="turtledb-item-tooltip-line">\s*(\d+)\s*格挡\s*<\/div>/);
    if (m) s.blockValue += parseInt(m[1], 10);

    // spells 区段
    const spellBlocks = h.match(/<div class="turtledb-item-tooltip-spells">[\s\S]*?<\/div>/g) || [];
    for (const block of spellBlocks) {
      const txt = block.replace(/<[^>]+>/g, '');

      // 攻击强度: "+N 攻击强度"
      let sm = txt.match(/\+(\d+)\s*攻击强度/);
      if (sm) s.attackPower += parseInt(sm[1], 10);

      // 法术能量: "提高所有法术和魔法效果所造成的伤害和治疗效果, 最多N点"
      sm = txt.match(/提高所有法术和魔法效果所造成的伤害和治疗效果[，,]\s*最多\s*(\d+)\s*点/);
      if (sm) s.spellPower += parseInt(sm[1], 10);

      // 治疗效果: "提高法术所造成的治疗效果, 最多N点"
      sm = txt.match(/提高法术所造成的治疗效果[，,]\s*最多\s*(\d+)\s*点/);
      if (sm) s.healPower += parseInt(sm[1], 10);

      // 物理暴击
      sm = txt.match(/使你造成致命一击的几率提高\s*(\d+)\s*%/);
      if (sm) s.crit += parseInt(sm[1], 10);
      // 法术暴击
      sm = txt.match(/使你的法术造成致命一击的几率提高\s*(\d+)\s*%/);
      if (sm) s.spellCrit += parseInt(sm[1], 10);
      // 物理命中
      sm = txt.match(/使你击中目标的几率提高\s*(\d+)\s*%/);
      if (sm) s.hit += parseInt(sm[1], 10);
      // 法术命中
      sm = txt.match(/使你的法术击中敌人的几率提高\s*(\d+)\s*%/);
      if (sm) s.spellHit += parseInt(sm[1], 10);
      // 急速 (攻击+施法)
      sm = txt.match(/使你的攻击和施法速度提高\s*(\d+)\s*%/);
      if (sm) s.haste += parseInt(sm[1], 10);
      // 防御技能
      sm = txt.match(/防御技能提高\s*(\d+)\s*点/);
      if (sm) s.defense += parseInt(sm[1], 10);
      // 躲闪
      sm = txt.match(/使你躲闪攻击的几率提高\s*(\d+)\s*%/);
      if (sm) s.dodge += parseInt(sm[1], 10);
      // 招架
      sm = txt.match(/使你招架攻击的几率提高\s*(\d+)\s*%/);
      if (sm) s.parry += parseInt(sm[1], 10);
      // 盾牌格挡几率
      sm = txt.match(/使你用盾牌格挡攻击的几率提高\s*(\d+)\s*%/);
      if (sm) s.blockChance += parseInt(sm[1], 10);
      // 盾牌格挡值 (spell 加成)
      sm = txt.match(/使你的盾牌的格挡值提高\s*(\d+)\s*点/);
      if (sm) s.blockValue += parseInt(sm[1], 10);
      // 每5秒法力回复
      sm = txt.match(/每5秒回复\s*(\d+)\s*点法力值/);
      if (sm) s.manaPer5 += parseInt(sm[1], 10);
    }
    return s;
  }

  // 累加所有已穿戴装备的属性
  function aggregateStats() {
    const agg = {
      strength: 0, agility: 0, stamina: 0, intellect: 0, spirit: 0, armor: 0,
      damageMin: 0, damageMax: 0, speed: 0, attackPower: 0,
      crit: 0, hit: 0, haste: 0,
      defense: 0, dodge: 0, parry: 0, blockValue: 0, blockChance: 0,
      spellPower: 0, healPower: 0, spellCrit: 0, spellHit: 0, manaPer5: 0
    };
    const slots = currentSlots();
    for (const slot in slots) {
      const itemId = slots[slot];
      if (itemId == null) continue;
      const item = state.itemsDb[itemId];
      if (!item) continue;
      const s = parseItemStats(item);
      for (const k in s) {
        if (k === 'speed') continue; // 速度不累加, 取主手速度
        agg[k] += s[k] || 0;
      }
    }
    return agg;
  }

  // 渲染属性统计框 (4 个 stat-box, 2x2 网格, 装下 22 个属性)
  // 分组: 基础 6 / 物理 6 / 防御 5 / 法术 5 = 22
  function renderStatBoxes() {
    if (!panelEl) return;
    const stats = aggregateStats();
    // 一行一个属性 (name, val)
    const basic = [
      ['力量', stats.strength],
      ['敏捷', stats.agility],
      ['耐力', stats.stamina],
      ['智力', stats.intellect],
      ['精神', stats.spirit],
      ['护甲', stats.armor]
    ];
    const physical = [
      ['伤害', stats.damageMin + '-' + stats.damageMax],
      ['速度', stats.speed > 0 ? stats.speed.toFixed(2) : '0.00'],
      ['强度', stats.attackPower],
      ['命中', fmtPct(stats.hit)],
      ['暴击', fmtPct(stats.crit)],
      ['急速', fmtPct(stats.haste)]
    ];
    const defense = [
      ['防御', stats.defense],
      ['躲闪', fmtPct(stats.dodge)],
      ['招架', fmtPct(stats.parry)],
      ['格挡值', stats.blockValue],
      ['格挡率', fmtPct(stats.blockChance)]
    ];
    const spell = [
      ['法伤', stats.spellPower],
      ['治疗', stats.healPower],
      ['法暴', fmtPct(stats.spellCrit)],
      ['法命', fmtPct(stats.spellHit)],
      ['急速', fmtPct(stats.haste)],
      ['回蓝', stats.manaPer5]
    ];
    fillStatBox1('.stat-box-basic', '基础', basic);
    fillStatBox1('.stat-box-physical', '物理', physical);
    fillStatBox1('.stat-box-defense', '防御', defense);
    fillStatBox1('.stat-box-spell', '法术', spell);
  }

  function fillStatBox1(selector, title, rows) {
    const box = $(selector, panelEl);
    if (!box) return;
    const titleEl = box.querySelector('.stat-box-title');
    if (titleEl) titleEl.textContent = title;
    const rowsEl = box.querySelector('.stat-box-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    rows.forEach(([name, val]) => {
      const row = document.createElement('div');
      row.className = 'stat-box-row';
      const n = document.createElement('span');
      n.className = 'stat-name';
      n.textContent = name;
      const v = document.createElement('span');
      v.className = 'stat-val';
      v.textContent = val;
      row.appendChild(n);
      row.appendChild(v);
      rowsEl.appendChild(row);
    });
  }

  function fmtPct(n) {
    return (n || 0).toFixed(2) + '%';
  }

  function fillStatBox(selector, title, rows) {
    const box = $(selector, panelEl);
    if (!box) return;
    const titleEl = box.querySelector('.stat-box-title');
    if (titleEl) titleEl.textContent = title;
    const rowsEl = box.querySelector('.stat-box-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    rows.forEach(cols => {
      const row = document.createElement('div');
      row.className = 'stat-box-row';
      // 2 列: 奇数 index = name (灰色), 偶数 index = val (绿色)
      for (let i = 0; i < cols.length; i++) {
        const span = document.createElement('span');
        if (i % 2 === 0) {
          span.className = 'stat-name';
          span.textContent = cols[i];
        } else {
          span.className = 'stat-val';
          span.textContent = cols[i];
        }
        row.appendChild(span);
      }
      rowsEl.appendChild(row);
    });
  }

  // -------- Storage --------
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        loadouts: state.loadouts, current: state.currentLoadout, loadoutOrder: state.loadoutOrder
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.loadouts && typeof d.loadouts === 'object') state.loadouts = d.loadouts;
      if (d.current && state.loadouts[d.current]) state.currentLoadout = d.current;
      // 兼容老数据: 没有 loadoutOrder 字段时, 从 loadouts key 顺序初始化
      if (Array.isArray(d.loadoutOrder) && d.loadoutOrder.length) {
        // 过滤掉已不存在的 key
        state.loadoutOrder = d.loadoutOrder.filter(n => state.loadouts[n]);
        // 补齐 loadouts 中存在但 order 中缺失的 (兜底)
        Object.keys(state.loadouts).forEach(n => {
          if (state.loadoutOrder.indexOf(n) === -1) state.loadoutOrder.push(n);
        });
      } else {
        state.loadoutOrder = Object.keys(state.loadouts);
      }
    } catch (e) {}
  }
  function savePanelState() {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state.panel)); } catch (e) {}
  }
  function loadPanelState() {
    try {
      const raw = localStorage.getItem(PANEL_STATE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') state.panel = d;
      }
    } catch (e) {}
  }

  function currentSlots() {
    const cur = state.loadouts[state.currentLoadout];
    return cur ? cur.slots : {};
  }
  function setSlot(slot, itemId) {
    const cur = state.loadouts[state.currentLoadout];
    if (!cur) return;
    if (itemId == null) delete cur.slots[slot];
    else cur.slots[slot] = itemId;
    saveState();
  }

  // -------- 2H Weapon Logic --------
  function isItem2H(itemId) {
    const info = getItemSlotInfo(itemId);
    return !!(info && info.is2h);
  }

  /**
   * Equip an item, enforcing 2H weapon rules:
   *  - 2H to mainhand: clear offhand
   *  - 2H to ranged (bow/xbow/gun): no offhand conflict
   *  - 1H to offhand: if mainhand has 2H, clear mainhand
   *  - 1H to mainhand: no extra action
   */
  function equipItemToSlot(itemId, slot) {
    // 配方 id (e.g. "s20854") 解析成产物 id (e.g. 16983), 让图标/名称/toast 都能查到
    const realId = resolveEquipableId(itemId);
    const info = getItemSlotInfo(realId);
    if (!info) return;

    const is2H = !!info.is2h;
    const slots = currentSlots();

    // 双手武器: 强制去主手 (或远程, 如果只有远程槽)
    if (is2H) {
      if (slot === 'offhand') slot = 'mainhand';
    }

    let clearedOffhand = false;
    let clearedMainhand = false;

    if (is2H && slot === 'mainhand') {
      // 清空副手
      if (slots.offhand != null) {
        delete slots.offhand;
        clearedOffhand = true;
      }
    } else if (slot === 'offhand' && !is2H) {
      // 装到副手: 若主手是双手, 清空主手
      const mainId = slots.mainhand;
      if (mainId != null && isItem2H(mainId)) {
        delete slots.mainhand;
        clearedMainhand = true;
      }
    }

    // 检测主手被覆盖 (装备 2H 时如果主手原来有东西, 算"卸下原主手")
    const mainReplaced = (slot === 'mainhand' && is2H && slots.mainhand != null && slots.mainhand !== realId);

    slots[slot] = realId;
    saveState();
    renderSlots();

    const slotName = SLOT_BY_KEY[slot] ? SLOT_BY_KEY[slot].name : slot;
    const item = state.itemsDb[realId];
    const verb = is2H && slot === 'mainhand' ? '已装备双手' : '已装备';
    showToast(verb + ': ' + ((item && item.name) || ('#' + realId)) + ' → ' + slotName);

    // 双手装备: 提示副手 / 主手被自动卸下
    if (is2H && slot === 'mainhand') {
      if (clearedOffhand && mainReplaced) {
        setTimeout(() => showToast('已自动卸下原主手 + 副手 (双手武器)', true), 800);
      } else if (clearedOffhand) {
        setTimeout(() => showToast('副手已自动卸下 (双手武器)', true), 800);
      } else if (mainReplaced) {
        setTimeout(() => showToast('原主手已被替换 (双手武器)', true), 800);
      }
    } else if (clearedMainhand) {
      setTimeout(() => showToast('主手已自动卸下 (双手武器冲突)', true), 800);
    }
  }

  function unequipSlot(slot) {
    setSlot(slot, null);
    renderSlots();
    const slotName = SLOT_BY_KEY[slot] ? SLOT_BY_KEY[slot].name : slot;
    showToast('已卸下: ' + slotName);
  }

  // -------- Toast --------
  function showToast(msg, isWarn) {
    let t = document.querySelector('.equip-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'equip-toast';
      document.body.appendChild(t);
    }
    t.className = 'equip-toast' + (isWarn ? ' warn' : '');
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // -------- Data Loading --------
  async function loadData() {
    try {
      const [itemsRes, lootRes] = await Promise.all([
        fetch('data/items_db.json'),
        fetch('data/loot_db.json').catch(() => null)
      ]);
      state.itemsDb = await itemsRes.json();
      if (lootRes) {
        try { buildDescById(await lootRes.json()); } catch (e) {}
      }
      console.log('[equip] items_db:', Object.keys(state.itemsDb).length,
                  'descById:', Object.keys(state.descById).length);
    } catch (e) {
      console.error('[equip] failed to load data', e);
    }
  }

  // 从 loot_db.json 抽取 {id(String) -> description}, {recipeId -> 完整对象}, {itemId -> 来源描述}
  function buildDescById(loot) {
    const map = {};
    const recipes = {};
    const sourceById = {};
    if (!loot) { state.descById = map; state.recipesById = recipes; state.sourceById = sourceById; return map; }
    // professions.<prof>.items — 配方 id 记为 "专业", 产物 id (craftItemId) 也记为同一个专业
    if (loot.professions && typeof loot.professions === 'object') {
      for (const [profKey, prof] of Object.entries(loot.professions)) {
        if (prof && Array.isArray(prof.items)) {
          for (const it of prof.items) {
            if (it && it.id) {
              if (it.description) map[String(it.id)] = it.description;
              if (it.craftItemId) recipes[String(it.id)] = it;
              // 来源: 配方 id 和产物 id 都映射到该专业
              if (prof.name) {
                const label = '来自 ' + prof.name + '专业';
                sourceById[String(it.id)] = { type: 'profession', label, profKey };
                if (it.craftItemId) sourceById[String(it.craftItemId)] = { type: 'profession', label, profKey };
              }
            }
          }
        }
      }
    }
    // categories.<dungeonType>.<dungeon>.bosses.<boss> = items[]
    if (loot.categories && typeof loot.categories === 'object') {
      for (const [catType, cat] of Object.entries(loot.categories)) {
        if (!cat || typeof cat !== 'object') continue;
        for (const [dungeonKey, dungeon] of Object.entries(cat)) {
          if (!dungeon || typeof dungeon !== 'object' || !dungeon.bosses) continue;
          const prefix = catType === 'raids' ? '团队副本' : '副本';
          for (const [bossName, items] of Object.entries(dungeon.bosses)) {
            if (Array.isArray(items)) {
              for (const it of items) {
                if (it && it.id && it.description) map[String(it.id)] = it.description;
                // 来源: boss 掉落 (优先, 覆盖 profession 标记如果重复)
                if (it && it.id) {
                  const label = '来自' + prefix + ' ' + dungeon.name + ' ' + bossName;
                  sourceById[String(it.id)] = { type: 'boss', label, dungeonKey, bossName, catType };
                }
              }
            }
          }
        }
      }
    }
    state.descById = map;
    state.recipesById = recipes;
    state.sourceById = sourceById;
    return map;
  }

  // 描述标签 -> 槽位配置
  // 优先级: 远程2H > 双手武器 > 盾 > 远程1H > 护甲 > 单手武器
  function parseDescToSlotInfo(desc) {
    if (!desc || typeof desc !== 'string') return null;
    const tags = desc.match(/#[a-zA-Z]\d+#/g);
    if (!tags || tags.length === 0) return null;

    // 1. 远程 2H (弓/枪): 强制 ranged + 2H
    if (tags.indexOf('#w3#') >= 0 || tags.indexOf('#w5#') >= 0) {
      return { slots: ['ranged'], is2h: true, tags };
    }
    // 2. 双手武器 (#h2# / 双手斧/长柄/法杖/长矛)
    if (tags.indexOf('#h2#') >= 0 || tags.indexOf('#w2#') >= 0
        || tags.indexOf('#w7#') >= 0 || tags.indexOf('#w9#') >= 0
        || tags.indexOf('#w15#') >= 0) {
      return { slots: ['mainhand'], is2h: true, tags };
    }
    // 3. 盾: 强制 offhand
    if (tags.indexOf('#w8#') >= 0) {
      return { slots: ['offhand'], is2h: false, tags };
    }
    // 4. 远程 1H (飞刀/魔杖)
    if (tags.indexOf('#w11#') >= 0 || tags.indexOf('#w12#') >= 0) {
      return { slots: ['ranged'], is2h: false, tags };
    }
    // 5. 护甲槽位
    const sMap = {
      '#s1#': ['head'],
      '#s2#': ['neck'],
      '#s3#': ['shoulder'],
      '#s4#': ['back'],
      '#s5#': ['chest'],
      '#s8#': ['wrist'],
      '#s9#': ['hands'],
      '#s10#': ['waist'],
      '#s11#': ['legs'],
      '#s12#': ['feet'],
      '#s13#': ['finger1', 'finger2'],
      '#s14#': ['trinket1', 'trinket2'],
      '#s15#': ['offhand']
    };
    for (const tag of tags) {
      if (sMap[tag]) return { slots: sMap[tag], is2h: false, tags };
    }
    // 6. 单手武器 (#h1#/#h3# + 武器类型): mainhand + offhand
    if (tags.indexOf('#h1#') >= 0 || tags.indexOf('#h3#') >= 0
        || tags.indexOf('#w1#') >= 0 || tags.indexOf('#w4#') >= 0
        || tags.indexOf('#w6#') >= 0 || tags.indexOf('#w10#') >= 0) {
      return { slots: ['mainhand', 'offhand'], is2h: false, tags };
    }
    return null;
  }

  // 配方产物的 items_db html -> 槽位配置 (回退链: 配方没 desc 时用)
  // html 形如 <td>主手</td><td>剑</td> / <td>头部</td> / <td>单手</td> 等
  const HTML_SLOT_MAP = {
    '主手': { slots: ['mainhand'], is2h: false },
    '副手': { slots: ['offhand'],  is2h: false },
    '单手': { slots: ['mainhand', 'offhand'], is2h: false },
    '双手': { slots: ['mainhand'], is2h: true },
    '远程': { slots: ['ranged'],   is2h: true },
    '头部': { slots: ['head'],     is2h: false },
    '颈部': { slots: ['neck'],     is2h: false },
    '肩部': { slots: ['shoulder'], is2h: false },
    '披风': { slots: ['back'],     is2h: false },
    '背部': { slots: ['back'],     is2h: false },
    '胸部': { slots: ['chest'],    is2h: false },
    '手腕': { slots: ['wrist'],    is2h: false },
    '手':   { slots: ['hands'],    is2h: false },
    '腰部': { slots: ['waist'],    is2h: false },
    '腿部': { slots: ['legs'],     is2h: false },
    '脚':   { slots: ['feet'],     is2h: false },
    '戒指': { slots: ['finger1', 'finger2'], is2h: false },
    '饰品': { slots: ['trinket1', 'trinket2'], is2h: false }
  };
  function parseHtmlToSlotInfo(html) {
    if (!html || typeof html !== 'string') return null;
    const tds = html.match(/<td[^>]*>([^<]+)<\/td>/g);
    if (!tds) return null;
    for (const td of tds) {
      const txt = td.replace(/<[^>]+>/g, '').trim();
      const hit = HTML_SLOT_MAP[txt];
      if (hit) return Object.assign({}, hit, { tags: [] });
    }
    return null;
  }

  /**
   * 解析物品槽位信息, 三级回退:
   *   1. loot_db 配方自身 description
   *   2. loot_db 配方自身没有, 但有 craftItemId -> 产物的 description
   *   3. 产物的 items_db html 里的槽位单元格
   * 返回 { slots:[], is2h:bool, tags:[] } 或 null
   */
  function getItemSlotInfo(itemId) {
    const key = String(itemId);
    // 0. 直接查 itemsDb html (产物 id, e.g. 16983)
    const directItem = state.itemsDb && state.itemsDb[key];
    if (directItem && directItem.html) {
      const parsed = parseHtmlToSlotInfo(directItem.html);
      if (parsed) return parsed;
    }
    // 1. 自身 desc (loot_db.professions / categories.bosses)
    let desc = state.descById && state.descById[key];
    if (desc) {
      const parsed = parseDescToSlotInfo(desc);
      if (parsed) return parsed;
    }
    // 2. 配方 -> craftItemId -> 产物的 desc
    const recipe = state.recipesById && state.recipesById[key];
    const productKey = recipe && recipe.craftItemId ? String(recipe.craftItemId) : null;
    if (productKey && productKey !== key) {
      desc = state.descById && state.descById[productKey];
      if (desc) {
        const parsed = parseDescToSlotInfo(desc);
        if (parsed) return parsed;
      }
      // 3. 产物的 items_db html 解析槽位 (兜底, 如 s20854 -> 16983 熔铸头盔)
      const product = state.itemsDb && state.itemsDb[productKey];
      if (product && product.html) {
        const parsed = parseHtmlToSlotInfo(product.html);
        if (parsed) return parsed;
      }
    }
    return null;
  }

  // -------- Panel Building --------
  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'equip-panel' + (state.panel.collapsed ? ' collapsed' : '');
    panelEl.innerHTML = `
      <div class="equip-header">
        <div class="equip-title">装备 · <span class="equip-loadout-current">${escapeHtml(state.currentLoadout)}</span></div>
        <div class="equip-controls">
          <button class="equip-btn equip-collapse" title="折叠/展开">${state.panel.collapsed ? '+' : '−'}</button>
        </div>
      </div>
      <div class="equip-body">
        <div class="equip-body-inner">
          <div class="equip-left">
            <div class="equip-paper-doll">
              <div class="equip-stat-box stat-box-basic">
                <div class="stat-box-title">基础</div>
                <div class="stat-box-rows"></div>
              </div>
              <div class="equip-stat-box stat-box-physical">
                <div class="stat-box-title">物理</div>
                <div class="stat-box-rows"></div>
              </div>
              <div class="equip-stat-box stat-box-defense">
                <div class="stat-box-title">防御</div>
                <div class="stat-box-rows"></div>
              </div>
              <div class="equip-stat-box stat-box-spell">
                <div class="stat-box-title">法术</div>
                <div class="stat-box-rows"></div>
              </div>
            </div>
            <div class="equip-loadouts">
              <div class="equip-section-label">配装列表</div>
              <div class="equip-loadout-list">
                <button class="equip-loadout-add" title="新建空白配装">+ 新建</button>
              </div>
            </div>
          </div>
          <div class="equip-equipped-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panelEl);

    bindPanelEvents();
    bindEquippedListEvents();
    renderPaperDoll();
    renderSlots();
    renderEquippedList();
    renderLoadouts();

    if (state.panel.x != null && state.panel.y != null) {
      panelEl.style.left = state.panel.x + 'px';
      panelEl.style.top = state.panel.y + 'px';
      panelEl.style.right = 'auto';
    }
  }

  function renderPaperDoll() {
    const pd = $('.equip-paper-doll', panelEl);
    // 只清空 slot 元素, 保留 stat-box 统计框
    $$('.equip-slot', pd).forEach(el => el.remove());
    // 按 SLOTS 的 side+row 定位: 绝对定位 class 由 CSS 处理
    SLOTS.forEach(s => {
      const cell = document.createElement('div');
      cell.className = 'equip-slot side-' + s.side;
      if (s.row != null) cell.classList.add('row-' + s.row);
      cell.classList.add(s.key); // 用于 mainhand/offhand/ranged 微调定位
      cell.dataset.slot = s.key;
      cell.title = s.name;
      pd.appendChild(cell);
    });
  }

  function renderSlots() {
    const slots = currentSlots();
    $$('.equip-slot', panelEl).forEach(el => {
      const k = el.dataset.slot;
      const itemId = slots[k];
      const item = itemId != null ? state.itemsDb[itemId] : null;
      el.classList.toggle('has-item', !!item);
      el.innerHTML = '';
      if (item) {
        const img = document.createElement('img');
        img.src = iconUrl(item.icon || '');
        img.alt = item.name || '';
        el.appendChild(img);
        const border = document.createElement('div');
        border.className = 'slot-quality-border';
        const qColor = qualityColor(item.quality);
        border.style.borderColor = qColor;
        el.appendChild(border);
        el.style.setProperty('--slot-glow', qualityGlow(item.quality));
      } else {
        const s = SLOT_BY_KEY[k];
        const empty = document.createElement('span');
        empty.className = 'slot-empty';
        empty.textContent = s ? s.name : k;
        el.appendChild(empty);
        el.style.setProperty('--slot-glow', 'transparent');
      }
    });
    renderEquippedList();
    renderStatBoxes();
  }

  // -------- Equipped List (右侧列表, 参照 eq.png) --------
  function renderEquippedList() {
    const list = $('.equip-equipped-list', panelEl);
    if (!list) return;
    const slots = currentSlots();
    list.innerHTML = '';
    SLOT_DISPLAY_ORDER.forEach(slotKey => {
      const itemId = slots[slotKey];
      const item = itemId != null ? state.itemsDb[itemId] : null;
      const row = document.createElement('div');
      const empty = !item;
      row.className = 'equip-equipped-row' + (empty ? ' empty' : '');
      row.dataset.slot = slotKey;

      const label = document.createElement('span');
      label.className = 'eq-slot-name';
      label.textContent = SLOT_LABEL_CN[slotKey] || slotKey;
      if (!empty) {
        // 槽位名颜色跟随装备品质 (CSS .eq-slot-name 用 --q-color)
        label.style.setProperty('--q-color', qualityColor(item.quality));
      }
      row.appendChild(label);

      const lvl = document.createElement('span');
      lvl.className = 'eq-item-level';
      if (!empty) {
        lvl.textContent = parseItemLevel(item);
      }
      row.appendChild(lvl);

      const name = document.createElement('span');
      name.className = 'eq-item-name';
      if (empty) {
        name.textContent = '— 空 —';
      } else {
        name.textContent = item.name || ('#' + itemId);
        // 装备名颜色跟随品质 (CSS .eq-item-name 用 --q-color)
        const qColor = qualityColor(item.quality);
        name.style.setProperty('--q-color', qColor);
      }
      row.appendChild(name);

      // hover tooltip / 右键卸下 / 点击高亮 - 用事件委托到 list 容器, 避免子元素间移动闪烁
      row.dataset.slotKey = slotKey;
      if (!empty) {
        row.dataset.itemId = itemId;
      }
      list.appendChild(row);
    });
  }

  // 装备列表 hover tooltip - 委托处理, 解决子元素间移动时 tooltip 闪烁/消失问题
  function bindEquippedListEvents() {
    const list = $('.equip-equipped-list', panelEl);
    if (!list || list._tipBound) return;
    list._tipBound = true;
    let tipTimer = 0;
    list.addEventListener('mouseover', e => {
      const row = e.target.closest('.equip-equipped-row');
      if (!row || row.classList.contains('empty')) return;
      // 在子元素间移动时 mouseover 也会冒泡, relatedTarget 在 row 内则忽略
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      const itemId = +row.dataset.itemId;
      if (!itemId) return;
      clearTimeout(tipTimer);
      showEquipTooltip(itemId, row, 'top');
    });
    list.addEventListener('mouseout', e => {
      const row = e.target.closest('.equip-equipped-row');
      if (!row) return;
      // 鼠标移入 row 内其他子元素, 不算离开
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => {
        // 最终检查: 鼠标是否还在列表里
        if (!list.querySelector('.equip-equipped-row:hover')) hideEquipTooltip();
      }, 120);
    });
    list.addEventListener('contextmenu', e => {
      const row = e.target.closest('.equip-equipped-row');
      if (!row || row.classList.contains('empty')) return;
      e.preventDefault();
      e.stopPropagation();
      const itemId = +row.dataset.itemId;
      const item = state.itemsDb[itemId];
      showSlotCtxMenu(e.clientX, e.clientY, row.dataset.slotKey, itemId, item);
    });
    list.addEventListener('click', e => {
      const row = e.target.closest('.equip-equipped-row');
      if (!row || row.classList.contains('empty')) return;
      const cell = panelEl.querySelector(`.equip-slot[data-slot="${row.dataset.slotKey}"]`);
      if (cell) {
        cell.classList.add('flash');
        setTimeout(() => cell.classList.remove('flash'), 800);
      }
    });
  }

  // 配装列表渲染: 每一行可点击恢复配装, 行内附 复制/删除 按钮
  function renderLoadouts() {
    const list = $('.equip-loadout-list', panelEl);
    if (!list) return;
    // 仅清空行元素, 保留"新建"按钮 (最后一项)
    $$('.equip-loadout-row, .equip-loadout-empty', list).forEach(el => el.remove());
    // 用 loadoutOrder 保持稳定顺序
    const names = state.loadoutOrder.filter(n => state.loadouts[n]);
    // 兜底: 兜住 loadouts 中存在但 order 缺失的
    Object.keys(state.loadouts).forEach(n => {
      if (names.indexOf(n) === -1) names.push(n);
    });
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'equip-loadout-empty';
      empty.textContent = '尚无配装';
      // 插到 "新建" 按钮之前
      const addBtn = list.querySelector('.equip-loadout-add');
      list.insertBefore(empty, addBtn);
      return;
    }
    names.forEach(name => {
      const isActive = name === state.currentLoadout;
      const ld = state.loadouts[name];
      const itemCount = ld.slots ? Object.keys(ld.slots).filter(k => ld.slots[k] != null).length : 0;
      const row = document.createElement('div');
      row.className = 'equip-loadout-row' + (isActive ? ' active' : '');
      row.dataset.name = name;
      row.title = '点击恢复此配装 (' + itemCount + ' 件装备)';
      row.innerHTML = `
        <input class="equip-loadout-name ${isActive ? 'active' : ''}" data-name="${escapeHtml(name)}" value="${escapeHtml(name)}" title="单击切换配装, 双击重命名, 右键重命名 (${itemCount} 件装备)">
        <span class="equip-loadout-count">${itemCount}</span>
        <button class="equip-loadout-btn" data-act="share" data-name="${escapeHtml(name)}" title="复制分享链接到剪贴板">↗</button>
        <button class="equip-loadout-btn" data-act="copy" data-name="${escapeHtml(name)}" title="复制当前配装创建新配装">复</button>
        <button class="equip-loadout-btn danger" data-act="del" data-name="${escapeHtml(name)}" title="删除配装">×</button>
      `;
      // 插到 "新建" 按钮之前, 保证按钮始终在最后
      const addBtn = list.querySelector('.equip-loadout-add');
      list.insertBefore(row, addBtn);
    });
  }

  // 恢复配装: 切换 currentLoadout, 重新渲染所有视图
  function applyLoadout(name) {
    if (!state.loadouts[name]) return;
    state.currentLoadout = name;
    saveState();
    renderSlots();
    renderEquippedList();
    renderStatBoxes();
    renderLoadouts();
    updateTitle();
    showToast('已恢复配装: ' + name);
  }

  // 复制当前激活配装创建新配装 (复制按钮 = 克隆)
  function copyLoadout() {
    const cur = state.loadouts[state.currentLoadout];
    if (!cur) return;
    const baseName = state.currentLoadout;
    // 自动找不重名
    let newName = baseName + ' 副本';
    let n = 2;
    while (state.loadouts[newName]) {
      newName = baseName + ' 副本' + n;
      n++;
    }
    state.loadouts[newName] = {
      name: newName,
      slots: JSON.parse(JSON.stringify(cur.slots || {}))
    };
    // 追加到顺序末尾
    if (state.loadoutOrder.indexOf(newName) === -1) state.loadoutOrder.push(newName);
    state.currentLoadout = newName;
    saveState();
    renderLoadouts();
    renderSlots();
    updateTitle();
    showToast('已复制配装: ' + newName);
  }

  // 新建空白配装 (不弹框, 默认配装N)
  function addNewLoadout() {
    let n = 1;
    let name;
    do {
      name = '配装' + n;
      n++;
    } while (state.loadouts[name]);
    state.loadouts[name] = { name, slots: {} };
    if (state.loadoutOrder.indexOf(name) === -1) state.loadoutOrder.push(name);
    state.currentLoadout = name;
    saveState();
    renderLoadouts();
    renderSlots();
    updateTitle();
  }

  // 删除配装
  function deleteLoadout(name) {
    if (Object.keys(state.loadouts).length <= 1) {
      showToast('至少保留一个配装', true);
      return;
    }
    if (!state.loadouts[name]) return;
    delete state.loadouts[name];
    const idx = state.loadoutOrder.indexOf(name);
    if (idx >= 0) state.loadoutOrder.splice(idx, 1);
    if (state.currentLoadout === name) {
      state.currentLoadout = state.loadoutOrder[0] || Object.keys(state.loadouts)[0];
    }
    saveState();
    renderLoadouts();
    renderSlots();
    renderEquippedList();
    updateTitle();
    showToast('已删除配装: ' + name);
  }

  // 配装 -> 编码 (base64 utf8)
  function encodeLoadout(ld) {
    try {
      const json = JSON.stringify(ld);
      return btoa(unescape(encodeURIComponent(json)));
    } catch (e) { return ''; }
  }
  function decodeLoadout(b64) {
    try {
      const json = decodeURIComponent(escape(atob(b64)));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  // 分享配装: 生成 URL 并复制到剪贴板
  function shareLoadout(name) {
    const ld = state.loadouts[name];
    if (!ld) return;
    const payload = {
      n: ld.name,
      s: ld.slots || {}
    };
    const code = encodeLoadout(payload);
    const base = location.origin + location.pathname;
    const url = base + '#ld=' + code;
    // 复制到剪贴板
    const copyOk = (txt) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(txt);
      }
      // fallback
      return new Promise((resolve, reject) => {
        try {
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject();
        } catch (e) { reject(e); }
      });
    };
    copyOk(url).then(() => {
      showToast('已复制分享链接: ' + name);
    }).catch(() => {
      // 复制失败时弹窗让用户手动复制
      prompt('请手动复制分享链接:', url);
    });
  }

  // 从 URL hash 恢复分享的配装
  function importLoadoutFromHash() {
    const m = (location.hash || '').match(/ld=([^&]+)/);
    if (!m) return false;
    const data = decodeLoadout(m[1]);
    if (!data || !data.s) return false;
    // 生成不重名的配装名
    const baseName = data.n || '分享配装';
    let name = baseName;
    let n = 2;
    while (state.loadouts[name]) {
      name = baseName + ' (' + n + ')';
      n++;
    }
    // 仅保留已识别的槽位
    const validSlots = {};
    Object.keys(data.s).forEach(k => {
      if (SLOT_BY_KEY[k] && data.s[k] != null) validSlots[k] = data.s[k];
    });
    state.loadouts[name] = { name, slots: validSlots };
    if (state.loadoutOrder.indexOf(name) === -1) state.loadoutOrder.push(name);
    state.currentLoadout = name;
    saveState();
    // 清理 URL hash 避免重复导入
    history.replaceState(null, '', location.pathname + location.search);
    // 渲染 (下一帧, 等待 panelEl 初始化)
    setTimeout(() => {
      renderLoadouts();
      renderSlots();
      renderEquippedList();
      renderStatBoxes();
      updateTitle();
      showToast('已导入分享配装: ' + name + ' (' + Object.keys(validSlots).length + ' 件)');
    }, 0);
    return true;
  }

  function bindPanelEvents() {
    // 折叠
    $('.equip-collapse', panelEl).addEventListener('click', e => {
      e.stopPropagation();
      state.panel.collapsed = !state.panel.collapsed;
      panelEl.classList.toggle('collapsed', state.panel.collapsed);
      $('.equip-collapse', panelEl).textContent = state.panel.collapsed ? '+' : '−';
      savePanelState();
    });

    // 拖动
    const header = $('.equip-header', panelEl);
    header.addEventListener('mousedown', e => {
      if (e.target.closest('.equip-btn')) return;
      isDragging = true;
      panelEl.classList.add('dragging');
      const r = panelEl.getBoundingClientRect();
      dragOffset.x = e.clientX - r.left;
      dragOffset.y = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      panelEl.style.left = (e.clientX - dragOffset.x) + 'px';
      panelEl.style.top = (e.clientY - dragOffset.y) + 'px';
      panelEl.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      panelEl.classList.remove('dragging');
      const r = panelEl.getBoundingClientRect();
      state.panel.x = r.left;
      state.panel.y = r.top;
      savePanelState();
    });

    // 槽位 hover 显示 tooltip
    panelEl.addEventListener('mouseover', e => {
      const slotEl = e.target.closest('.equip-slot');
      if (!slotEl) return;
      const slot = slotEl.dataset.slot;
      const itemId = currentSlots()[slot];
      if (itemId == null) return;
      showEquipTooltip(itemId, slotEl);
    });
    panelEl.addEventListener('mouseout', e => {
      const slotEl = e.target.closest('.equip-slot');
      if (!slotEl) return;
      setTimeout(() => {
        if (!panelEl.querySelector('.equip-slot:hover')) hideEquipTooltip();
      }, 80);
    });

    // 槽位右键 - 卸下
    panelEl.addEventListener('contextmenu', e => {
      const slotEl = e.target.closest('.equip-slot');
      if (!slotEl) return;
      e.preventDefault();
      e.stopPropagation();
      const slot = slotEl.dataset.slot;
      const itemId = currentSlots()[slot];
      if (itemId == null) {
        showToast('此槽位无装备', true);
        return;
      }
      const item = state.itemsDb[itemId];
      showSlotCtxMenu(e.clientX, e.clientY, slot, itemId, item);
    });

    // 配装按钮 + 行点击
    let clickTimer = null;
    panelEl.addEventListener('click', e => {
      const btn = e.target.closest('.equip-loadout-btn');
      if (btn) {
        e.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        if (btn.dataset.act === 'share') shareLoadout(btn.dataset.name);
        else if (btn.dataset.act === 'copy') copyLoadout();
        else if (btn.dataset.act === 'del') deleteLoadout(btn.dataset.name);
        return;
      }
      // 点击行 (非按钮) -> 延迟切换, 给 dblclick 一个机会
      const row = e.target.closest('.equip-loadout-row');
      if (row) {
        if (clickTimer) clearTimeout(clickTimer);
        const targetName = row.dataset.name;
        clickTimer = setTimeout(() => {
          applyLoadout(targetName);
          clickTimer = null;
        }, 220);
      }
      if (e.target.closest('.equip-loadout-add')) {
        e.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        addNewLoadout();
      }
    });

    // 双击配装名进入编辑模式 (selectAll)
    panelEl.addEventListener('dblclick', e => {
      const inp = e.target.closest('.equip-loadout-name');
      if (!inp) return;
      e.stopPropagation();
      e.preventDefault();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      // 等下一帧再 focus (避免 click handler 重建 DOM 抢占焦点)
      setTimeout(() => {
        const cur = panelEl.querySelector('.equip-loadout-name[data-name="' + cssEscape(inp.dataset.name) + '"]');
        if (cur) { cur.focus(); cur.select(); }
      }, 0);
    });

    // 右键配装名 -> 直接进入编辑模式 (focus + selectAll)
    panelEl.addEventListener('contextmenu', e => {
      const inp = e.target.closest('.equip-loadout-name');
      if (!inp) return;
      e.preventDefault();
      e.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      // 等下一帧 focus (避免 click handler 重建 DOM 抢占焦点)
      setTimeout(() => {
        const cur = panelEl.querySelector('.equip-loadout-name[data-name="' + cssEscape(inp.dataset.name) + '"]');
        if (cur) { cur.focus(); cur.select(); }
      }, 0);
    });

    // 配装重命名
    panelEl.addEventListener('change', e => {
      if (!e.target.classList.contains('equip-loadout-name')) return;
      const oldName = e.target.dataset.name;
      const newName = e.target.value.trim();
      if (!newName || newName === oldName) { e.target.value = oldName; e.target.readOnly = true; return; }
      if (state.loadouts[newName]) {
        showToast('名称已存在', true);
        e.target.value = oldName;
        e.target.readOnly = true;
        return;
      }
      const ld = state.loadouts[oldName];
      delete state.loadouts[oldName];
      ld.name = newName;
      state.loadouts[newName] = ld;
      // 保持顺序: 用旧名位置替换为新名
      const idx = state.loadoutOrder.indexOf(oldName);
      if (idx >= 0) state.loadoutOrder[idx] = newName;
      if (state.currentLoadout === oldName) state.currentLoadout = newName;
      saveState();
      renderLoadouts();
      updateTitle();
      showToast('已重命名: ' + newName);
    });

    // 双击配装名进入编辑模式
    panelEl.addEventListener('dblclick', e => {
      const inp = e.target.closest('.equip-loadout-name');
      if (!inp) return;
      e.stopPropagation();
      inp.readOnly = false;
      inp.focus();
      inp.select();
    });

    // 配装名输入框: Enter 失焦保存, Esc 取消
    panelEl.addEventListener('keydown', e => {
      if (!e.target.classList.contains('equip-loadout-name')) return;
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.target.value = e.target.dataset.name; e.target.blur(); }
    });

    // 失焦时恢复 readOnly
    panelEl.addEventListener('blur', e => {
      if (e.target.classList && e.target.classList.contains('equip-loadout-name')) {
        e.target.readOnly = true;
      }
    }, true);
  }

  function updateTitle() {
    const span = $('.equip-loadout-current', panelEl);
    if (span) span.textContent = state.currentLoadout;
    $$('.equip-loadout-name', panelEl).forEach(inp => {
      inp.classList.toggle('active', inp.value === state.currentLoadout);
    });
  }

  // -------- Tooltip (hover over equipped item) --------
  function showEquipTooltip(itemId, anchorEl, side) {
    const item = state.itemsDb[itemId];
    if (!item) return;
    hideEquipTooltip();
    equipTooltipEl = document.createElement('div');
    equipTooltipEl.className = 'equip-tooltip';
    if (item.html) {
      equipTooltipEl.innerHTML = item.html;
    } else {
      equipTooltipEl.textContent = item.name || ('#' + itemId);
    }
    // 来源行 (来自 <专业> / 来自副本 <副本名> <boss>)
    const src = state.sourceById && state.sourceById[String(itemId)];
    if (src && src.label) {
      const srcEl = document.createElement('div');
      srcEl.className = 'equip-tooltip-source';
      srcEl.textContent = src.label;
      equipTooltipEl.appendChild(srcEl);
    }
    document.body.appendChild(equipTooltipEl);
    positionTooltipNear(equipTooltipEl, anchorEl, side || 'right');
  }
  function hideEquipTooltip() {
    if (equipTooltipEl) {
      equipTooltipEl.remove();
      equipTooltipEl = null;
    }
  }

  // -------- Compare Tooltip (follows the original WoW tooltip / mouse) --------
  function findOriginalTooltip() {
    // 覆盖原站点的多种 tooltip class
    return $('.wow-tooltip, .tooltip-modal, .turtledb-tooltip-container, [class*="turtledb-tooltip"]',
            document.body);
  }

  function showCompareTooltip(pageItem) {
    if (!pageItem) return;
    const itemId = parseItemIdFromElement(pageItem);
    if (itemId == null) return;
    const slotInfo = getItemSlotInfo(itemId);
    if (!slotInfo || !slotInfo.slots || slotInfo.slots.length === 0) return;
    const slots = currentSlots();
    // Find a compatible slot with different equipped item
    let equippedId = null, equippedSlot = null;
    for (const s of slotInfo.slots) {
      if (slots[s] != null && slots[s] !== itemId) {
        equippedId = slots[s];
        equippedSlot = s;
        break;
      }
    }
    if (equippedId == null) {
      hideCompareTooltip();
      return;
    }
    const item = state.itemsDb[equippedId];
    if (!item) return;

    hideCompareTooltip();
    compareTooltipEl = document.createElement('div');
    compareTooltipEl.className = 'equip-compare-tip';

    if (item.html) {
      compareTooltipEl.innerHTML = item.html;
    } else {
      compareTooltipEl.textContent = item.name || ('#' + equippedId);
    }

    // "已装备 XX" 角标 (绝对定位在 tooltip 右上角)
    const label = document.createElement('div');
    label.className = 'equip-compare-label';
    const sName = SLOT_BY_KEY[equippedSlot] ? SLOT_BY_KEY[equippedSlot].name : equippedSlot;
    label.textContent = '已装备 ' + sName;
    compareTooltipEl.appendChild(label);

    // 首次定位: 优先原 tooltip 右侧, 否则鼠标右侧
    const orig = findOriginalTooltip();
    if (orig) {
      compareTrackMode = 'anchor';
      positionCompareNextToAnchor(orig);
    } else {
      compareTrackMode = 'mouse';
      positionCompareNearMouse(pageItem);
    }
    document.body.appendChild(compareTooltipEl);

    // 启动 RAF 跟踪: 让对比 tooltip 跟随原 tooltip (或鼠标) 移动
    startCompareTracking();
  }

  function hideCompareTooltip() {
    stopCompareTracking();
    if (compareTooltipEl) {
      compareTooltipEl.remove();
      compareTooltipEl = null;
    }
  }

  function startCompareTracking() {
    stopCompareTracking();
    const tick = () => {
      if (!compareTooltipEl) return;
      const orig = findOriginalTooltip();
      if (orig) {
        compareTrackMode = 'anchor';
        positionCompareNextToAnchor(orig);
      } else if (currentHoveredPageItem) {
        // 原 tooltip 暂未出现, 先跟随鼠标
        compareTrackMode = 'mouse';
        positionCompareNearMouse(currentHoveredPageItem);
      }
      compareTrackRAF = requestAnimationFrame(tick);
    };
    compareTrackRAF = requestAnimationFrame(tick);
  }
  function stopCompareTracking() {
    if (compareTrackRAF) {
      cancelAnimationFrame(compareTrackRAF);
      compareTrackRAF = 0;
    }
  }

  function positionCompareNextToAnchor(orig) {
    if (!compareTooltipEl) return;
    const r = orig.getBoundingClientRect();
    let x = r.right + 8;
    let y = r.top;
    const tr = compareTooltipEl.getBoundingClientRect();
    if (x + tr.width > window.innerWidth) {
      x = r.left - tr.width - 8;
    }
    if (y + tr.height > window.innerHeight) y = window.innerHeight - tr.height - 8;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    compareTooltipEl.style.left = x + 'px';
    compareTooltipEl.style.top = y + 'px';
  }

  function positionCompareNearMouse(anchor) {
    if (!compareTooltipEl) return;
    let mx, my;
    if (lastMouse && lastMouse.x != null) {
      mx = lastMouse.x; my = lastMouse.y;
    } else {
      const ar = anchor.getBoundingClientRect();
      mx = ar.right; my = ar.top;
    }
    const tr = compareTooltipEl.getBoundingClientRect();
    let x = mx + 16;
    let y = my + 16;
    if (x + tr.width > window.innerWidth) x = mx - tr.width - 16;
    if (y + tr.height > window.innerHeight) y = window.innerHeight - tr.height - 8;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    compareTooltipEl.style.left = x + 'px';
    compareTooltipEl.style.top = y + 'px';
  }

  function positionTooltipNear(tip, anchor, side) {
    const r = anchor.getBoundingClientRect();
    let x, y;
    if (side === 'right') {
      x = r.right + 8;
      y = r.top;
    } else if (side === 'left') {
      // 先 append, 再算
      const tr = tip.getBoundingClientRect();
      x = r.left - tr.width - 8;
      y = r.top;
    } else if (side === 'top') {
      // tooltip 显示在锚点上方, 横向居中
      const tr = tip.getBoundingClientRect();
      x = r.left + r.width / 2 - tr.width / 2;
      y = r.top - tr.height - 8;
    } else if (side === 'bottom') {
      // tooltip 显示在锚点下方, 横向居中
      const tr = tip.getBoundingClientRect();
      x = r.left + r.width / 2 - tr.width / 2;
      y = r.bottom + 8;
    }
    const tr = tip.getBoundingClientRect();
    if (x + tr.width > window.innerWidth) {
      x = r.left - tr.width - 8;
    }
    if (y + tr.height > window.innerHeight) y = window.innerHeight - tr.height - 8;
    if (y < 0) {
      // 顶部空间不够, 改为锚点下方
      y = r.bottom + 8;
      if (y + tr.height > window.innerHeight) y = 4;
    }
    if (x < 0) x = 4;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  // -------- Parse item ID from page element --------
  // 返回原始 id 格式: 数字 (22383) 或字符串 ("s20854" 配方)
  function parseItemIdFromElement(el) {
    if (!el) return null;
    const norm = v => /^\d+$/.test(v) ? parseInt(v, 10) : v;
    if (el.dataset && el.dataset.equipItemId) {
      return norm(String(el.dataset.equipItemId).trim());
    }
    const idEl = el.querySelector ? el.querySelector('.item-id') : null;
    if (idEl) {
      const m = (idEl.textContent || '').match(/([A-Za-z]?\d{1,7})/);
      if (m) return norm(m[1]);
    }
    const m2 = (el.textContent || '').match(/ID[:\s]*([A-Za-z]?\d{1,7})/);
    if (m2) return norm(m2[1]);
    return null;
  }

  // 把配方 id 解析成产物 id (用于装备时存到槽位, 让图标/名称能查到)
  // 配方 (e.g. "s20854") -> 产物 (e.g. 16983); 非配方原样返回
  function resolveEquipableId(itemId) {
    const key = String(itemId);
    const recipe = state.recipesById && state.recipesById[key];
    if (recipe && recipe.craftItemId) return recipe.craftItemId;
    // 兼容已经是产物的 id (数字或字符串都行)
    return itemId;
  }

  // -------- Context Menu (page item right-click) --------
  function showItemCtxMenu(x, y, itemId) {
    closeCtxMenu();
    const slotInfo = getItemSlotInfo(itemId);
    const item = state.itemsDb[itemId];
    if (!item) return;
    ctxMenuEl = document.createElement('div');
    ctxMenuEl.className = 'equip-ctx-menu';
    ctxMenuEl.style.left = x + 'px';
    ctxMenuEl.style.top = y + 'px';

    const title = document.createElement('div');
    title.className = 'equip-ctx-item equip-ctx-title';
    title.textContent = item.name || ('#' + itemId);
    ctxMenuEl.appendChild(title);

    // 品质色小色块 (CSS .equip-ctx-title 用 --q-color)
    const qColor = qualityColor(item.quality);
    title.style.setProperty('--q-color', qColor);

    ctxMenuEl.appendChild(makeSep());

    const validSlots = (slotInfo && slotInfo.slots) ? slotInfo.slots : [];
    const is2H = !!(slotInfo && slotInfo.is2h);

    if (validSlots.length === 0) {
      const noSlot = document.createElement('div');
      noSlot.className = 'equip-ctx-item equip-ctx-disabled';
      noSlot.textContent = '(此物品无法装备)';
      ctxMenuEl.appendChild(noSlot);
    } else {
      validSlots.forEach(slotKey => {
        // 双手武器不应该在 offhand 出现
        if (is2H && slotKey === 'offhand') return;
        const slot = SLOT_BY_KEY[slotKey];
        const existing = currentSlots()[slotKey];
        const opt = document.createElement('div');
        opt.className = 'equip-ctx-item';
        const tag = (is2H && slotKey === 'mainhand') ? ' [双手]' : '';
        opt.innerHTML = `<span class="ctx-slot-icon"></span>装备到 ${slot.name}${tag}${existing ? ' (覆盖)' : ''}`;
        opt.addEventListener('click', () => {
          equipItemToSlot(itemId, slotKey);
          closeCtxMenu();
        });
        ctxMenuEl.appendChild(opt);
      });
    }

    // 卸下选项
    const hasEquipped = validSlots.some(s => {
      if (is2H && s === 'offhand') return false;
      return currentSlots()[s] != null;
    });
    if (hasEquipped) {
      ctxMenuEl.appendChild(makeSep());
      validSlots.forEach(slotKey => {
        if (is2H && slotKey === 'offhand') return;
        const slot = SLOT_BY_KEY[slotKey];
        const existing = currentSlots()[slotKey];
        if (existing == null) return;
        const opt = document.createElement('div');
        opt.className = 'equip-ctx-item';
        const eqName = state.itemsDb[existing] ? state.itemsDb[existing].name : ('#'+existing);
        opt.innerHTML = `<span class="ctx-slot-icon"></span>卸下 ${slot.name} (${eqName})`;
        opt.addEventListener('click', () => {
          unequipSlot(slotKey);
          closeCtxMenu();
        });
        ctxMenuEl.appendChild(opt);
      });
    }

    document.body.appendChild(ctxMenuEl);
    const rect = ctxMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) ctxMenuEl.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) ctxMenuEl.style.top = (y - rect.height) + 'px';
    setTimeout(() => {
      document.addEventListener('mousedown', closeCtxMenuOnOutside, { once: true });
    }, 0);
  }
  function makeSep() { const s = document.createElement('div'); s.className = 'equip-ctx-sep'; return s; }

  function closeCtxMenu() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
  function closeCtxMenuOnOutside(e) { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); }

  function showSlotCtxMenu(x, y, slot, itemId, item) {
    closeCtxMenu();
    ctxMenuEl = document.createElement('div');
    ctxMenuEl.className = 'equip-ctx-menu';
    ctxMenuEl.style.left = x + 'px';
    ctxMenuEl.style.top = y + 'px';
    const title = document.createElement('div');
    title.className = 'equip-ctx-item equip-ctx-title';
    const slotName = SLOT_BY_KEY[slot] ? SLOT_BY_KEY[slot].name : slot;
    title.textContent = (item ? item.name : '') + ' @ ' + slotName;
    // 品质色小色块 (CSS .equip-ctx-title 用 --q-color)
    title.style.setProperty('--q-color', qualityColor(item && item.quality));
    ctxMenuEl.appendChild(title);
    ctxMenuEl.appendChild(makeSep());
    const opt = document.createElement('div');
    opt.className = 'equip-ctx-item';
    opt.textContent = '卸下';
    opt.addEventListener('click', () => { unequipSlot(slot); closeCtxMenu(); });
    ctxMenuEl.appendChild(opt);
    document.body.appendChild(ctxMenuEl);
    const rect = ctxMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) ctxMenuEl.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) ctxMenuEl.style.top = (y - rect.height) + 'px';
    setTimeout(() => {
      document.addEventListener('mousedown', closeCtxMenuOnOutside, { once: true });
    }, 0);
  }

  // -------- DOM Scanning --------
  function scanItems(root) {
    const ctx = root || document.body;
    // 1) 优先 .loot-card 父级 (整张卡 hover 触发对比)
    $$('.loot-card', ctx).forEach(bindCard);
    // 2) .reagent-info 单独处理 (无 loot-card 父级的物品, 比如材料/搜索结果)
    $$('.reagent-info', ctx).forEach(el => {
      if (el.closest('.loot-card')) return; // 父级是 loot-card 的话由它处理
      bindCard(el);
    });
    // 3) 兜底: 单独的 .item-info (无 loot-card 父级, 比如搜索结果列表)
    $$('.item-info', ctx).forEach(el => {
      if (el.closest('.loot-card')) return;
      bindCard(el);
    });
  }

  function bindCard(card) {
    if (card.dataset && card.dataset.equipBound === '1') return;
    const id = parseItemIdFromElement(card);
    if (id == null) return;
    card.dataset.equipItemId = id;
    card.dataset.equipBound = '1';
    card.addEventListener('contextmenu', onItemContextMenu, true);
    card.addEventListener('mouseenter', onItemHover);
    card.addEventListener('mouseleave', onItemLeave);
  }

  function onItemContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget;
    const id = parseItemIdFromElement(card);
    if (id == null) return;
    const slotInfo = getItemSlotInfo(id);
    if (!slotInfo || !slotInfo.slots || slotInfo.slots.length === 0) {
      showToast('此物品无法装备', true);
      return;
    }
    // 双手武器: 远程类(弓/弩/枪/长柄/长矛/法杖) -> ranged; 近战双手(#h2#) -> mainhand
    if (slotInfo.is2h) {
      const target = slotInfo.slots && slotInfo.slots.indexOf('ranged') >= 0 ? 'ranged' : 'mainhand';
      equipItemToSlot(id, target);
      return;
    }
    // 主手类单手武器(#h3#) -> 只能装主手, 直接装备不弹菜单
    const tags = slotInfo.tags || [];
    if (tags.indexOf('#h3#') >= 0) {
      equipItemToSlot(id, 'mainhand');
      return;
    }
    // 单槽 -> 直接装备
    if (slotInfo.slots.length === 1) {
      equipItemToSlot(id, slotInfo.slots[0]);
    } else {
      // 多槽 (戒指/饰品/1H武器) -> 弹选择
      showItemCtxMenu(e.clientX, e.clientY, id);
    }
  }

  function onItemHover(e) {
    const card = e.currentTarget;
    currentHoveredPageItem = card;
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      if (currentHoveredPageItem === card) showCompareTooltip(card);
    }, 150);
  }
  function onItemLeave(e) {
    if (currentHoveredPageItem === e.currentTarget) {
      currentHoveredPageItem = null;
      clearTimeout(tooltipTimer);
      setTimeout(() => {
        if (!currentHoveredPageItem) hideCompareTooltip();
      }, 80);
    }
  }

  // 原 tooltip 消失 -> 同步关闭对比
  new MutationObserver(() => {
    const orig = $('.wow-tooltip', document.body);
    if (!orig && !currentHoveredPageItem) hideCompareTooltip();
  }).observe(document.body, { childList: true, subtree: false });

  // 监听新物品
  new MutationObserver(muts => {
    let need = false;
    for (const m of muts) {
      if (!m.addedNodes) continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList && (n.classList.contains('item-info') || n.classList.contains('reagent-info')
            || n.classList.contains('loot-card') || n.classList.contains('loot-grid')
            || n.classList.contains('search-items-grid') || n.classList.contains('reagents-items'))) {
          need = true; break;
        }
        if (n.querySelector && (n.querySelector('.item-info') || n.querySelector('.loot-card'))) {
          need = true; break;
        }
      }
      if (need) break;
    }
    if (need) {
      clearTimeout(scanItems._t);
      scanItems._t = setTimeout(() => scanItems(), 100);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // -------- Init --------
  loadState();
  loadPanelState();
  // 优先检查 URL hash 中的分享配装 (loadState 之后, 覆盖 state)
  importLoadoutFromHash();
  loadData().then(() => {
    buildPanel();
    scanItems();
    console.log('[equip] panel ready');
  });
})();
