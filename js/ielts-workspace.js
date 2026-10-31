/* Shared IELTS navigation and display preferences; grading stays in each test. */
window.IELTSWorkspace = (() => {
  let options, currentQuestion;
  let active = 0;
  let groups = [];
  const byId = id => document.getElementById(id);
  const questions = index => options.parts[index].questionSets.flatMap(set => set.questions);
  const answered = number => Boolean(String(options.getState().answers[number] ?? '').trim());
  const groupFor = index => groups.findIndex(group => group.parts.includes(index));
  const entries = group => group.parts.flatMap(index => questions(index).map(question => ({ question, index })));

  function mount(settings) {
    options = settings;
    const state = options.getState();
    state.flags ||= {};
    state.lastQuestionByGroup ||= {};
    // Keep the original submit button and all its event handlers when rebuilding.
    const submit = byId('btn-submit-test');
    byId('test-screen').querySelector('.exam-submit-row').append(submit);
    for (const id of ['exam-toolbar', 'exam-navigation', 'exam-settings', 'exam-overview']) byId(id)?.remove();
    groups = [];
    options.parts.forEach((part, index) => {
      const title = part.navigationGroup || questions(index)[0]?.sectionLabel?.split(' — ')[0] || part.title;
      let group = groups.find(item => item.title === title);
      if (!group) { group = { title, parts: [] }; groups.push(group); }
      group.parts.push(index);
    });
    const screen = byId('test-screen');
    const toolbar = document.createElement('div');
    toolbar.id = 'exam-toolbar';
    toolbar.innerHTML = `<div class="exam-heading"><h2 id="active-part-title"></h2><span id="exam-part-progress" role="status"></span></div>
      <div class="exam-tools">
        <button type="button" id="review-question" class="test-secondary" aria-pressed="false">⚑ Xem lại</button>
        <button type="button" id="exam-overview-open" class="test-secondary" aria-haspopup="dialog" aria-controls="exam-overview">Tổng quan</button>
        <button type="button" id="exam-settings-open" class="test-secondary" aria-haspopup="dialog" aria-controls="exam-settings">Tùy chọn</button>
      </div>
      <div id="exam-mobile-panes" role="group" aria-label="Nội dung hiển thị">
        <button type="button" data-pane="reading" aria-pressed="true">Bài đọc / Đề bài</button>
        <button type="button" data-pane="questions" aria-pressed="false">Câu hỏi</button>
      </div>`;
    screen.prepend(toolbar);
    toolbar.querySelector('.exam-tools').append(submit);
    byId('review-question').addEventListener('click', () => {
      if (currentQuestion === undefined) return;
      state.flags[currentQuestion] = !state.flags[currentQuestion];
      options.save(); refresh();
    });
    toolbar.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => setPane(button.dataset.pane)));
    const navigation = document.createElement('nav');
    navigation.id = 'exam-navigation';
    navigation.setAttribute('aria-label', 'Điều hướng bài thi');
    navigation.innerHTML = `<div class="exam-question-row"><button type="button" id="previous-part" class="test-secondary" aria-label="Phần trước" title="Phần trước">←</button><div id="exam-questions" aria-label="Câu hỏi"></div><button type="button" id="next-part" class="test-secondary" aria-label="Phần tiếp theo" title="Phần tiếp theo">→</button></div><div id="exam-parts" role="tablist" aria-label="Các phần bài thi"></div>`;
    screen.append(navigation);
    groups.forEach((group, groupIndex) => {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.id = `exam-tab-${groupIndex}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', group.parts.map(index => `exam-part-${index}`).join(' '));
      tab.textContent = tab.title = group.title;
      tab.addEventListener('click', () => selectGroup(groupIndex));
      tab.addEventListener('keydown', event => {
        const target = { ArrowRight: (groupIndex + 1) % groups.length, ArrowLeft: (groupIndex + groups.length - 1) % groups.length, Home: 0, End: groups.length - 1 }[event.key];
        if (target === undefined) return;
        event.preventDefault(); selectGroup(target); byId(`exam-tab-${target}`).focus();
      });
      byId('exam-parts').append(tab);
    });
    options.parts.forEach((part, index) => {
      const panel = byId('questions-container').children[index];
      panel.classList.add('exam-part'); panel.id = `exam-part-${index}`;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `exam-tab-${groupFor(index)}`);
      panel.querySelectorAll('.scroll-pane').forEach(pane => pane.addEventListener('scroll', () => byId('highlight-btn')?.classList.add('hidden'), { passive: true }));
      panel.querySelectorAll('[data-question]').forEach(card => {
        const number = Number(card.dataset.question);
        card.querySelectorAll('input, textarea').forEach(input => {
          input.setAttribute(input.type === 'radio' ? 'aria-describedby' : 'aria-labelledby', `question-title-${number}`);
          input.addEventListener('focus', () => {
            if (currentQuestion === number) return;
            currentQuestion = number; rememberQuestion(); refresh(); revealNavigation();
          });
        });
        const writing = card.querySelector('textarea');
        if (writing) {
          card.querySelector('.word-count')?.remove();
          const count = document.createElement('p'); count.className = 'word-count';
          const updateCount = () => { count.textContent = `Số từ: ${writing.value.trim() ? writing.value.trim().split(/\s+/u).length : 0}`; };
          writing.after(count); writing.addEventListener('input', updateCount); updateCount();
        }
      });
    });
    createDialogs(screen);
    byId('previous-part').addEventListener('click', () => selectPart(active - 1));
    byId('next-part').addEventListener('click', () => selectPart(active + 1));
    setPane(state.mobilePane === 'questions' ? 'questions' : 'reading', false);
    selectPart(Number.isInteger(state.activePart) ? state.activePart : 0, false, state.activeQuestion);
    requestAnimationFrame(() => { byId(`question-${currentQuestion}`)?.scrollIntoView({ block: 'nearest' }); revealNavigation(); });
  }

  function rememberQuestion() {
    const state = options.getState();
    state.activePart = active; state.activeQuestion = currentQuestion;
    state.lastQuestionByGroup[groupFor(active)] = currentQuestion;
    options.save();
  }
  function setPane(pane, persist = true) {
    byId('test-screen').dataset.mobilePane = pane;
    byId('exam-mobile-panes').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === pane)));
    options.getState().mobilePane = pane;
    if (persist) options.save();
  }
  function selectGroup(index) {
    const group = groups[index];
    const entry = entries(group).find(({ question }) => question.number === options.getState().lastQuestionByGroup[index]);
    selectPart(entry?.index ?? group.parts[0], true, entry?.question.number);
    byId(`question-${currentQuestion}`)?.scrollIntoView({ block: 'nearest' });
  }
  function selectPart(index, persist = true, number) {
    active = Math.max(0, Math.min(options.parts.length - 1, index));
    currentQuestion = questions(active).find(question => question.number === number)?.number ?? questions(active)[0]?.number;
    const groupIndex = groupFor(active);
    document.querySelectorAll('.exam-part').forEach((panel, index) => { panel.hidden = index !== active; });
    byId('exam-parts').querySelectorAll('button').forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === groupIndex)); tab.tabIndex = index === groupIndex ? 0 : -1;
    });
    byId('active-part-title').textContent = byId('active-part-title').title = options.parts[active].title;
    byId('exam-questions').replaceChildren();
    entries(groups[groupIndex]).forEach(({ question, index }) => {
      const button = questionButton(question, index); button.dataset.questionNav = question.number; byId('exam-questions').append(button);
    });
    byId('previous-part').disabled = active === 0;
    byId('next-part').disabled = active === options.parts.length - 1;
    byId('highlight-btn')?.classList.add('hidden');
    if (persist) rememberQuestion();
    refresh(); revealNavigation();
  }
  function questionButton(question, index) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = question.displayNumber ?? question.number; button.dataset.number = question.number;
    button.title = `${options.parts[index].title} — Câu ${button.textContent}`;
    button.addEventListener('click', () => {
      if (byId('exam-overview').open) byId('exam-overview').close();
      selectPart(index, true, question.number); setPane('questions');
      const card = byId(`question-${question.number}`);
      card?.scrollIntoView({ block: 'nearest' });
      (card?.querySelector('input:checked') || card?.querySelector('input, textarea'))?.focus({ preventScroll: true });
    });
    return button;
  }
  function revealNavigation() {
    byId('exam-parts')?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    byId('exam-questions')?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function decorateQuestion(button) {
    const number = Number(button.dataset.number), flagged = Boolean(options.getState().flags[number]);
    button.classList.toggle('is-answered', answered(number)); button.classList.toggle('is-flagged', flagged);
    button.setAttribute('aria-current', String(number === currentQuestion));
    button.setAttribute('aria-label', `${button.title}: ${answered(number) ? 'đã trả lời' : 'chưa trả lời'}${flagged ? ', đánh dấu xem lại' : ''}`);
  }
  function refresh() {
    if (!options) return;
    const state = options.getState();
    byId('exam-questions').querySelectorAll('button').forEach(decorateQuestion);
    const review = byId('review-question'); review.disabled = currentQuestion === undefined;
    review.setAttribute('aria-pressed', String(Boolean(state.flags[currentQuestion])));
    review.textContent = state.flags[currentQuestion] ? '⚑ Đã đánh dấu' : '⚑ Xem lại';
    review.setAttribute('aria-label', `${state.flags[currentQuestion] ? 'Bỏ đánh dấu' : 'Đánh dấu xem lại'} câu ${questions(active).find(q => q.number === currentQuestion)?.displayNumber ?? currentQuestion}`);
    const partQuestions = questions(active);
    byId('exam-part-progress').textContent = `${partQuestions.filter(q => answered(q.number)).length}/${partQuestions.length} câu đã trả lời`;
    groups.forEach((group, index) => byId(`exam-tab-${index}`).setAttribute('aria-label', `${group.title}: ${entries(group).filter(({ question }) => answered(question.number)).length}/${entries(group).length} câu đã trả lời`));
  }
  function createDialogs(screen) {
    const settings = document.createElement('dialog'); settings.id = 'exam-settings'; settings.className = 'exam-dialog';
    settings.setAttribute('aria-labelledby', 'exam-settings-title');
    settings.innerHTML = `<div class="exam-dialog-heading"><h2 id="exam-settings-title">Tùy chọn & hướng dẫn</h2><button type="button" class="test-secondary" data-close aria-label="Đóng tùy chọn">✕</button></div>
      <label class="exam-size-label" for="exam-text-size">Cỡ chữ bài đọc và câu hỏi</label><select id="exam-text-size"><option value="normal">Tiêu chuẩn</option><option value="large">Lớn</option><option value="largest">Rất lớn</option></select>
      <ul class="exam-help"><li>Chọn phần ở hàng dưới cùng, rồi chọn câu hỏi ở hàng phía trên.</li><li>Dùng ⚑ để đánh dấu câu cần xem lại. Mở Tổng quan để tìm câu chưa trả lời hoặc đã đánh dấu.</li><li>Trên máy tính, kéo thanh giữa hai khung để đổi độ rộng. Có thể dùng phím ← / → khi thanh được chọn.</li><li>Trên điện thoại, chuyển giữa Bài đọc / Đề bài và Câu hỏi.</li><li>Bôi đen nội dung trong một đoạn văn để Highlight. Nhấn vào đoạn đã đánh dấu để bỏ Highlight.</li></ul>
      <p class="exam-legend"><span class="legend-answered"></span> Đã trả lời <span class="legend-flagged">⚑</span> Cần xem lại</p><button type="button" class="test-secondary exam-dialog-done" data-close>Xong</button>`;
    const overview = document.createElement('dialog'); overview.id = 'exam-overview'; overview.className = 'exam-dialog exam-overview-dialog';
    overview.setAttribute('aria-labelledby', 'exam-overview-title');
    overview.innerHTML = `<div class="exam-dialog-heading"><h2 id="exam-overview-title">Tổng quan bài làm</h2><button type="button" class="test-secondary" data-close aria-label="Đóng tổng quan">✕</button></div><p id="exam-overview-summary" role="status"></p>
      <label class="exam-size-label" for="exam-overview-filter">Hiển thị câu hỏi</label><select id="exam-overview-filter"><option value="all">Tất cả</option><option value="unanswered">Chưa trả lời</option><option value="flagged">Đã đánh dấu xem lại</option></select><div id="exam-overview-content"></div><button type="button" class="test-secondary exam-dialog-done" data-close>Tiếp tục làm bài</button>`;
    screen.append(settings, overview);
    for (const dialog of [settings, overview]) {
      dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), select, input, a[href], [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      dialog.addEventListener('click', event => {
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
      });
    }
    byId('exam-text-size').value = screen.dataset.textSize = ['normal', 'large', 'largest'].includes(options.getState().textSize) ? options.getState().textSize : 'normal';
    byId('exam-text-size').addEventListener('change', event => {
      screen.dataset.textSize = options.getState().textSize = event.target.value; options.save();
    });
    byId('exam-settings-open').addEventListener('click', () => settings.showModal());
    byId('exam-overview-open').addEventListener('click', () => { renderOverview(); overview.showModal(); });
    byId('exam-overview-filter').addEventListener('change', renderOverview);
  }
  function renderOverview() {
    const all = groups.flatMap(entries), flags = options.getState().flags;
    byId('exam-overview-summary').textContent = `${all.filter(({ question }) => answered(question.number)).length}/${all.length} câu đã trả lời · ${all.filter(({ question }) => flags[question.number]).length} câu đánh dấu xem lại`;
    const content = byId('exam-overview-content'), filter = byId('exam-overview-filter').value;
    content.replaceChildren();
    groups.forEach(group => {
      const visible = entries(group).filter(({ question }) => filter === 'unanswered' ? !answered(question.number) : filter === 'flagged' ? flags[question.number] : true);
      if (!visible.length) return;
      const section = document.createElement('section'), title = document.createElement('h3'), list = document.createElement('div');
      title.textContent = group.title; list.className = 'exam-overview-questions';
      visible.forEach(({ question, index }) => { const button = questionButton(question, index); decorateQuestion(button); list.append(button); });
      section.append(title, list); content.append(section);
    });
    if (!content.children.length) content.textContent = 'Không có câu hỏi phù hợp với bộ lọc này.';
  }
  function initResizers() {
    document.querySelectorAll('.resizer').forEach(resizer => {
      const container = resizer.parentElement;
      let dragging = false;
      const setWidth = value => {
        const width = Math.max(30, Math.min(70, value));
        document.querySelectorAll('.resizer').forEach(handle => {
          handle.parentElement.style.setProperty('--passage-width', `${width}%`);
          handle.setAttribute('aria-valuenow', String(Math.round(width)));
        });
        options.getState().passageWidth = width;
      };
      resizer.tabIndex = 0;
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-label', 'Điều chỉnh độ rộng bài đọc');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-valuemin', '30');
      resizer.setAttribute('aria-valuemax', '70');
      setWidth(Number.isFinite(options.getState().passageWidth) ? options.getState().passageWidth : 50);
      resizer.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        resizer.setPointerCapture(event.pointerId);
        container.classList.add('is-resizing');
      });
      resizer.addEventListener('pointermove', event => {
        if (!dragging) return;
        const bounds = container.getBoundingClientRect();
        if (bounds.width) setWidth((event.clientX - bounds.left) / bounds.width * 100);
      });
      const finish = () => { if (dragging) options.save(); dragging = false; container.classList.remove('is-resizing'); };
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
      resizer.addEventListener('lostpointercapture', finish);
      resizer.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        setWidth(event.key === 'Home' ? 50 : Number(resizer.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 5 : -5));
        options.save();
      });
    });
  }

  return { mount, refresh, initResizers };
})();
