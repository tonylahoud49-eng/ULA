import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  Clipboard,
  Copy,
  Database,
  FileArchive,
  Globe2,
  Mail,
  Menu,
  Printer,
  Search,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markdownPath = path.join(projectRoot, 'docs', 'ULA_FULL_DOCUMENTATION.md');
const outputPath = path.join(projectRoot, 'docs', 'ULA_FULL_DOCUMENTATION.html');

const readBase64 = async (relativePath) =>
  (await fs.readFile(path.join(projectRoot, relativePath))).toString('base64');

const [markdown, logo, sourceSansRegular, sourceSansSemibold, barlowSemibold] = await Promise.all([
  fs.readFile(markdownPath, 'utf8'),
  readBase64('src/assets/ula-logo.png'),
  readBase64('node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2'),
  readBase64('node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2'),
  readBase64('node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'),
]);

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[`'".:/()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const plainText = (children) =>
  React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? child : plainText(child.props?.children)))
    .join('');

const icon = (Icon, size = 18) =>
  renderToStaticMarkup(React.createElement(Icon, { size, strokeWidth: 1.8, 'aria-hidden': true }));

const components = {
  h2: ({ children }) => {
    const label = plainText(children);
    return React.createElement('h2', { id: slugify(label), tabIndex: -1 }, children);
  },
  h3: ({ children }) => {
    const label = plainText(children);
    return React.createElement('h3', { id: slugify(label), tabIndex: -1 }, children);
  },
  a: ({ href, children }) =>
    React.createElement('a', href?.startsWith('http') ? { href, target: '_blank', rel: 'noreferrer' } : { href }, children),
};

const renderMarkdown = (value) =>
  renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components }, value),
  );

const markdownWithoutTitle = markdown.replace(/^# .+\r?\n+/, '');
const firstSectionIndex = markdownWithoutTitle.search(/^## /m);
const introduction = markdownWithoutTitle.slice(0, firstSectionIndex).trim();
const sectionSource = markdownWithoutTitle.slice(firstSectionIndex);
const sections = sectionSource.split(/(?=^## )/gm).filter(Boolean);

const sectionData = sections.map((source) => {
  const title = source.match(/^## (.+)$/m)?.[1] ?? 'Section';
  const id = slugify(title);
  const children = [...source.matchAll(/^### (.+)$/gm)].map((match) => ({
    title: match[1],
    id: slugify(match[1]),
  }));
  return { title, id, children, html: renderMarkdown(source) };
});

const navMarkup = sectionData
  .map(
    (section) => `
      <li class="nav-section" data-nav-section="${section.id}">
        <a href="#${section.id}">${section.title}</a>
        ${
          section.children.length
            ? `<ul>${section.children.map((child) => `<li><a href="#${child.id}">${child.title}</a></li>`).join('')}</ul>`
            : ''
        }
      </li>`,
  )
  .join('');

const contentMarkup = sectionData
  .map(
    (section) => `
      <article class="doc-section" data-doc-section="${section.id}">
        ${section.html}
      </article>`,
  )
  .join('');

const css = String.raw`
@font-face{font-family:"Source Sans 3";src:url(data:font/woff2;base64,${sourceSansRegular}) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Source Sans 3";src:url(data:font/woff2;base64,${sourceSansSemibold}) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Barlow Condensed";src:url(data:font/woff2;base64,${barlowSemibold}) format("woff2");font-weight:600;font-display:swap}
:root{--teal:#1f8a78;--teal-dark:#14695d;--ink:#10231f;--sidebar:#102a25;--paper:#f4f7f5;--sheet:#fff;--quiet:#5c6965;--rule:#c6d0cc;--soft-rule:#e3e9e6;--mint:#e8f4f0;--amber:#a66c24;--amber-paper:#fcf5e8;--red:#a54740;--shadow:0 18px 38px -32px rgb(15 33 29 / .72);--sidebar-width:288px}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:32px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.58 "Source Sans 3",system-ui,sans-serif;letter-spacing:0}
body.nav-open{overflow:hidden}
::selection{background:#bfe7dc;color:var(--ink)}
::-webkit-scrollbar{width:11px;height:11px}::-webkit-scrollbar-track{background:#edf2ef}::-webkit-scrollbar-thumb{background:#9aa9a4;border:3px solid #edf2ef;border-radius:8px}
a{color:var(--teal-dark);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--teal)}
button,input{font:inherit}
button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid rgb(31 138 120 / .28);outline-offset:2px}
.scroll-progress{position:fixed;inset:0 auto auto 0;width:0;height:3px;background:var(--teal);z-index:50}
.skip-link{position:fixed;left:12px;top:8px;z-index:100;padding:9px 12px;background:var(--sheet);border:1px solid var(--teal);transform:translateY(-150%)}
.skip-link:focus{transform:none}
.sidebar{position:fixed;inset:0 auto 0 0;width:var(--sidebar-width);display:flex;flex-direction:column;background:var(--sidebar);color:#fff;z-index:30}
.brand{display:flex;align-items:center;gap:13px;min-height:88px;padding:18px 20px;border-bottom:1px solid rgb(255 255 255 / .12)}
.brand-logo{display:grid;place-items:center;width:47px;height:47px;background:#fff;border-radius:4px;padding:6px;flex:0 0 auto}.brand-logo img{display:block;max-width:100%;max-height:100%}
.brand strong{display:block;font-family:"Barlow Condensed",sans-serif;font-size:21px;line-height:1;letter-spacing:0}.brand span{display:block;margin-top:5px;color:#a9c4bb;font-size:12px;line-height:1.25}
.side-tools{padding:16px 16px 12px;border-bottom:1px solid rgb(255 255 255 / .1)}
.search-wrap{position:relative}.search-wrap svg{position:absolute;left:11px;top:11px;color:#78958b}.search-wrap input{width:100%;height:40px;padding:0 35px 0 37px;color:#fff;background:#183a33;border:1px solid #3c5c53;border-radius:4px}.search-wrap input::placeholder{color:#a9beb7}.search-clear{position:absolute;right:6px;top:5px;width:30px;height:30px;display:none;place-items:center;color:#b8cbc5;background:transparent;border:0;border-radius:4px;cursor:pointer}.search-clear.visible{display:grid}.search-status{min-height:18px;margin:7px 2px 0;color:#9eb7af;font-size:12px}
.toc{padding:14px 10px 24px;overflow:auto;overscroll-behavior:contain}.toc-label{margin:0 10px 10px;color:#8eaaa1;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em}.toc ul{list-style:none;margin:0;padding:0}.nav-section{margin-bottom:2px}.nav-section>a{display:block;padding:8px 10px;color:#dce9e5;border-radius:4px;font-size:14px;font-weight:600;text-decoration:none}.nav-section>a:hover,.nav-section>a.active{background:#1a443b;color:#fff}.nav-section>a.active{box-shadow:inset 3px 0 0 var(--teal)}.nav-section ul{display:none;padding:2px 0 7px 20px}.nav-section:has(>a.active) ul{display:block}.nav-section li a{display:block;padding:4px 8px;color:#9fb8b0;font-size:12px;line-height:1.25;text-decoration:none}.nav-section li a:hover{color:#fff}.nav-section[hidden]{display:none}
.sidebar-footer{margin-top:auto;padding:15px 20px;border-top:1px solid rgb(255 255 255 / .1);color:#92aaa2;font-size:12px}.sidebar-footer strong{display:block;color:#d8e5e1;font-weight:600}.close-nav{display:none}
.mobile-bar{display:none}.main{margin-left:var(--sidebar-width);min-width:0}
.masthead{padding:54px clamp(30px,5vw,76px) 42px;background:var(--sheet);border-bottom:1px solid var(--rule)}
.masthead-inner,.architecture-inner,.content-inner{max-width:1160px;margin:0 auto}
.hero{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:64px;align-items:end}.hero h1{max-width:720px;margin:0;font:600 58px/.92 "Barlow Condensed",sans-serif;letter-spacing:-.02em}.hero h1 span{display:block;color:var(--teal);font-size:.72em;margin-top:7px}.hero-summary{max-width:720px;margin:23px 0 0;color:#45534f;font-size:19px;line-height:1.5}.hero-intro{margin-top:16px;max-width:72ch;color:var(--quiet)}.hero-intro p{margin:0}
.edition{border-top:2px solid var(--ink);border-bottom:1px solid var(--rule)}.edition-row{display:flex;justify-content:space-between;gap:20px;padding:11px 0;border-bottom:1px solid var(--soft-rule)}.edition-row:last-child{border:0}.edition dt{color:var(--quiet);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.edition dd{margin:0;font-variant-numeric:tabular-nums;font-weight:600;text-align:right}.status-ok{color:var(--teal-dark)}
.action-row{display:flex;gap:8px;margin-top:29px}.action-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 14px;color:var(--ink);background:#fff;border:1px solid var(--rule);border-radius:4px;cursor:pointer}.action-button:hover{background:var(--mint);border-color:#8fbdb1}.action-button.primary{color:#fff;background:var(--teal);border-color:var(--teal);box-shadow:0 8px 18px -14px rgb(15 33 29 / .9)}.action-button svg{width:17px;height:17px}
.architecture{padding:34px clamp(30px,5vw,76px) 38px;background:#eaf0ed;border-bottom:1px solid var(--rule)}.architecture-head{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-bottom:18px}.architecture h2{margin:0;font:600 29px/1 "Barlow Condensed",sans-serif;letter-spacing:0}.architecture-head p{max-width:510px;margin:0;color:var(--quiet);font-size:14px;text-align:right}.system-flow{display:grid;grid-template-columns:1fr 34px 1fr 34px 1fr 34px 1.32fr;align-items:stretch}.system-node{display:flex;align-items:flex-start;gap:12px;min-height:96px;padding:16px;background:var(--sheet);border:1px solid var(--rule);border-radius:6px;box-shadow:var(--shadow)}.system-node svg{flex:0 0 auto;color:var(--teal)}.system-node strong{display:block;font-size:15px}.system-node span{display:block;margin-top:4px;color:var(--quiet);font-size:12px;line-height:1.35}.connector{display:grid;place-items:center;color:#789089;font-size:22px}.services{display:grid;grid-template-columns:1fr 1fr;gap:8px}.service{display:flex;align-items:center;gap:8px;padding:11px;background:#f8faf9;border:1px solid var(--soft-rule);border-radius:4px;font-size:12px;font-weight:600}.service svg{width:16px;height:16px;color:var(--teal-dark)}
.content{padding:20px clamp(30px,5vw,76px) 90px}.content-inner{background:var(--sheet);border:1px solid var(--rule);border-radius:6px;box-shadow:var(--shadow)}.doc-section{position:relative;padding:52px 64px 58px;border-bottom:1px solid var(--rule)}.doc-section:last-child{border-bottom:0}.doc-section[hidden]{display:none}.doc-section h2{margin:0 0 26px;font:600 35px/1 "Barlow Condensed",sans-serif;letter-spacing:0}.doc-section h3{margin:42px 0 14px;font:600 24px/1.12 "Barlow Condensed",sans-serif;letter-spacing:0}.doc-section p,.doc-section>ul,.doc-section>ol,.doc-section blockquote{max-width:74ch}.doc-section p{margin:0 0 17px}.doc-section ul,.doc-section ol{margin:0 0 20px;padding-left:24px}.doc-section li{margin:6px 0}.doc-section li::marker{color:var(--teal)}.doc-section strong{font-weight:600}.doc-section hr{border:0;border-top:1px solid var(--rule);margin:34px 0}.doc-section blockquote{margin:24px 0;padding:17px 18px;background:var(--amber-paper);border:1px solid #e1c995;border-radius:4px;color:#61461f}.doc-section blockquote p:last-child{margin-bottom:0}
.doc-section code{padding:2px 5px;color:#244a41;background:#eaf2ef;border-radius:3px;font:600 .84em/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.doc-section pre{position:relative;max-width:100%;margin:18px 0 24px;padding:20px 54px 20px 20px;overflow:auto;color:#e8f2ef;background:#132b26;border-radius:5px;font-size:13px;line-height:1.55;tab-size:2}.doc-section pre code{padding:0;color:inherit;background:transparent;font-weight:400}.copy-code{position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;gap:6px;height:31px;padding:0 9px;color:#c6d9d3;background:#1e4038;border:1px solid #45665e;border-radius:4px;cursor:pointer;font-size:12px}.copy-code:hover{color:#fff;background:#285149}.copy-code svg{width:14px;height:14px}
.doc-section table{width:100%;margin:18px 0 28px;border-collapse:collapse;font-size:14px}.doc-section th{padding:10px 12px;color:#31433e;background:#edf3f0;border:1px solid var(--rule);font-size:11px;text-align:left;text-transform:uppercase;letter-spacing:.08em}.doc-section td{padding:11px 12px;border:1px solid var(--rule);vertical-align:top}.doc-section tbody tr:nth-child(even){background:#fafcfb}
.empty-search{display:none;padding:70px 30px;text-align:center}.empty-search.visible{display:block}.empty-search svg{color:var(--teal)}.empty-search h2{font:600 30px/1 "Barlow Condensed",sans-serif}.empty-search p{color:var(--quiet)}
.back-top{position:fixed;right:22px;bottom:22px;z-index:15;display:none;width:42px;height:42px;color:#fff;background:var(--teal);border:0;border-radius:4px;box-shadow:0 10px 24px -15px #10231f;cursor:pointer}.back-top.visible{display:grid;place-items:center}.back-top svg{transform:rotate(-90deg)}
@media (max-width:980px){:root{--sidebar-width:268px}.hero{grid-template-columns:1fr;gap:30px}.edition{max-width:560px}.system-flow{grid-template-columns:1fr 28px 1fr 28px 1fr}.system-flow>.connector:nth-of-type(3),.system-flow>.services{display:none}.doc-section{padding:44px 42px}}
@media (max-width:760px){html{scroll-padding-top:74px}.sidebar{width:min(88vw,330px);transform:translateX(-102%);transition:transform .22s cubic-bezier(.16,1,.3,1);box-shadow:18px 0 42px -28px #071713}.nav-open .sidebar{transform:none}.mobile-scrim{position:fixed;inset:0;z-index:25;display:none;background:rgb(7 23 19 / .54)}.nav-open .mobile-scrim{display:block}.mobile-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;height:62px;padding:0 14px;background:rgb(255 255 255 / .96);border-bottom:1px solid var(--rule)}.mobile-brand{display:flex;align-items:center;gap:9px;font-family:"Barlow Condensed",sans-serif;font-size:19px;font-weight:600}.mobile-brand img{width:32px;height:32px;object-fit:contain}.icon-button{display:grid;place-items:center;width:40px;height:40px;color:var(--ink);background:#fff;border:1px solid var(--rule);border-radius:4px}.close-nav{position:absolute;right:12px;top:23px;display:grid;color:#fff;background:#173a32;border-color:#42645b}.main{margin-left:0}.masthead{padding:37px 20px 31px}.hero h1{font-size:42px}.hero-summary{font-size:17px}.action-row{flex-wrap:wrap}.action-button{flex:1 1 auto}.architecture{padding:29px 20px}.architecture-head{display:block}.architecture-head p{margin-top:10px;text-align:left}.system-flow{display:block}.system-node{min-height:0}.connector{height:28px;transform:rotate(90deg)}.services{display:grid;margin-top:8px}.content{padding:14px 12px 76px}.content-inner{border-radius:5px}.doc-section{padding:36px 22px 42px}.doc-section h2{font-size:30px}.doc-section h3{font-size:22px}.doc-section pre{margin-left:-10px;margin-right:-10px;padding:18px 49px 18px 15px}.doc-section table{display:block;overflow-x:auto}.back-top{right:13px;bottom:13px}}
@media (max-width:390px){.hero h1{font-size:38px}.services{grid-template-columns:1fr}.edition-row{align-items:flex-start}.edition dd{max-width:56%;word-break:break-word}.doc-section{padding-left:18px;padding-right:18px}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.sidebar{transition:none}}
@media print{body{background:#fff;font-size:10.5pt}.sidebar,.mobile-bar,.mobile-scrim,.action-row,.back-top,.scroll-progress,.copy-code{display:none!important}.main{margin:0}.masthead,.architecture,.content{padding-left:0;padding-right:0}.masthead{padding-top:0}.hero{grid-template-columns:1fr 220px}.hero h1{font-size:38pt}.architecture{break-inside:avoid;background:#fff}.system-flow{grid-template-columns:1fr 18px 1fr 18px 1fr 18px 1.3fr}.content-inner{border:0;box-shadow:none}.doc-section{padding:28px 0;break-before:page}.doc-section:first-child{break-before:auto}.doc-section pre{white-space:pre-wrap;word-break:break-word}.doc-section a{color:inherit;text-decoration:none}}
`;

const browserScript = String.raw`
(() => {
  const body = document.body;
  const sidebar = document.querySelector('.sidebar');
  const menuButton = document.querySelector('[data-menu]');
  const closeButton = document.querySelector('[data-close-menu]');
  const scrim = document.querySelector('.mobile-scrim');
  const search = document.querySelector('[data-search]');
  const clearSearch = document.querySelector('[data-clear-search]');
  const searchStatus = document.querySelector('[data-search-status]');
  const emptySearch = document.querySelector('.empty-search');
  const sections = [...document.querySelectorAll('[data-doc-section]')];
  const navSections = [...document.querySelectorAll('[data-nav-section]')];
  const backTop = document.querySelector('.back-top');
  const progress = document.querySelector('.scroll-progress');
  const copyIcon = ${JSON.stringify(icon(Copy, 14))};
  const checkIcon = ${JSON.stringify(icon(Check, 14))};

  const setMenu = (open) => {
    body.classList.toggle('nav-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) closeButton.focus();
  };
  menuButton.addEventListener('click', () => setMenu(true));
  closeButton.addEventListener('click', () => setMenu(false));
  scrim.addEventListener('click', () => setMenu(false));
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') && window.innerWidth <= 760) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('nav-open')) setMenu(false);
  });

  const runSearch = () => {
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    sections.forEach((section, index) => {
      const match = !query || section.textContent.toLowerCase().includes(query);
      section.hidden = !match;
      navSections[index].hidden = !match;
      if (match) matches += 1;
    });
    clearSearch.classList.toggle('visible', Boolean(query));
    emptySearch.classList.toggle('visible', matches === 0);
    searchStatus.textContent = query ? matches + ' of ' + sections.length + ' sections found' : sections.length + ' sections';
  };
  search.addEventListener('input', runSearch);
  clearSearch.addEventListener('click', () => { search.value = ''; runSearch(); search.focus(); });
  runSearch();

  document.querySelector('[data-print]').addEventListener('click', () => window.print());
  document.querySelectorAll('.doc-section pre').forEach((pre) => {
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.type = 'button';
    button.title = 'Copy command';
    button.innerHTML = copyIcon + '<span>Copy</span>';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);
      button.innerHTML = checkIcon + '<span>Copied</span>';
      setTimeout(() => { button.innerHTML = copyIcon + '<span>Copy</span>'; }, 1600);
    });
    pre.append(button);
  });

  const links = [...document.querySelectorAll('.nav-section > a')];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle('active', link.hash === '#' + visible.target.dataset.docSection));
  }, { rootMargin: '-10% 0px -75% 0px' });
  sections.forEach((section) => observer.observe(section));

  const updateScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    backTop.classList.toggle('visible', window.scrollY > 700);
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();
`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Complete ULA Claims Hub setup, deployment, operations, maintenance, backup, and troubleshooting manual.">
  <title>ULA Claims Hub | Operations Manual</title>
  <style>${css}</style>
</head>
<body>
  <div class="scroll-progress" aria-hidden="true"></div>
  <a class="skip-link" href="#manual-content">Skip to manual</a>
  <div class="mobile-scrim" aria-hidden="true"></div>
  <aside class="sidebar" aria-label="Documentation navigation">
    <div class="brand">
      <span class="brand-logo"><img src="data:image/png;base64,${logo}" alt="ULA"></span>
      <span><strong>Claims Hub Manual</strong><span>Operations and maintenance</span></span>
      <button class="icon-button close-nav" type="button" data-close-menu title="Close navigation" aria-label="Close navigation">${icon(X, 19)}</button>
    </div>
    <div class="side-tools">
      <div class="search-wrap">
        ${icon(Search, 17)}
        <input type="search" data-search placeholder="Search the manual" aria-label="Search the manual">
        <button class="search-clear" type="button" data-clear-search title="Clear search" aria-label="Clear search">${icon(X, 15)}</button>
      </div>
      <div class="search-status" data-search-status aria-live="polite"></div>
    </div>
    <nav class="toc" aria-label="Manual sections">
      <p class="toc-label">Contents</p>
      <ul>${navMarkup}</ul>
    </nav>
    <div class="sidebar-footer"><strong>Source of truth</strong>Generated from ULA_FULL_DOCUMENTATION.md</div>
  </aside>
  <main class="main">
    <header class="mobile-bar">
      <span class="mobile-brand"><img src="data:image/png;base64,${logo}" alt="">Claims Hub Manual</span>
      <button class="icon-button" type="button" data-menu aria-expanded="false" title="Open navigation" aria-label="Open navigation">${icon(Menu, 20)}</button>
    </header>
    <section class="masthead">
      <div class="masthead-inner">
        <div class="hero">
          <div>
            <h1>ULA Claims Hub<span>Operations Manual</span></h1>
            <p class="hero-summary">A complete, production-focused guide to deployment, PostgreSQL, IIS, NSSM, security, backups, workflows, and recovery.</p>
            <div class="hero-intro">${renderMarkdown(introduction)}</div>
            <div class="action-row">
              <button class="action-button primary" type="button" data-print>${icon(Printer, 17)} Print or save PDF</button>
              <a class="action-button" href="#1-system-overview">${icon(BookOpen, 17)} Start reading</a>
            </div>
          </div>
          <dl class="edition">
            <div class="edition-row"><dt>Edition</dt><dd>September 2026</dd></div>
            <div class="edition-row"><dt>Platform</dt><dd>Windows Server</dd></div>
            <div class="edition-row"><dt>Database</dt><dd>PostgreSQL 18</dd></div>
            <div class="edition-row"><dt>Production state</dt><dd class="status-ok">Documented</dd></div>
          </dl>
        </div>
      </div>
    </section>
    <section class="architecture" aria-labelledby="architecture-title">
      <div class="architecture-inner">
        <div class="architecture-head">
          <h2 id="architecture-title">Production architecture</h2>
          <p>One controlled request path, with PostgreSQL as shared system storage and server-only credentials for every external service.</p>
        </div>
        <div class="system-flow" role="img" aria-label="Browser connects through IIS HTTPS to the Node application, which uses PostgreSQL, uploads, AI providers, and email services">
          <div class="system-node">${icon(Globe2, 23)}<div><strong>Company browser</strong><span>Authenticated user on the ULA network</span></div></div>
          <div class="connector" aria-hidden="true">&rarr;</div>
          <div class="system-node">${icon(ShieldCheck, 23)}<div><strong>IIS and HTTPS</strong><span>TLS entry point and reverse proxy</span></div></div>
          <div class="connector" aria-hidden="true">&rarr;</div>
          <div class="system-node">${icon(Server, 23)}<div><strong>Node application</strong><span>NSSM service on 127.0.0.1:8787</span></div></div>
          <div class="connector" aria-hidden="true">&rarr;</div>
          <div class="services">
            <div class="service">${icon(Database, 16)} PostgreSQL</div>
            <div class="service">${icon(FileArchive, 16)} Uploads</div>
            <div class="service">${icon(BrainCircuit, 16)} AI providers</div>
            <div class="service">${icon(Mail, 16)} EmailJS</div>
          </div>
        </div>
      </div>
    </section>
    <section class="content" id="manual-content">
      <div class="content-inner">
        ${contentMarkup}
        <div class="empty-search">
          ${icon(Search, 30)}
          <h2>No matching section</h2>
          <p>Try a broader term such as PostgreSQL, IIS, backup, email, or service.</p>
        </div>
      </div>
    </section>
  </main>
  <button class="back-top" type="button" title="Back to top" aria-label="Back to top">${icon(ArrowRight, 18)}</button>
  <script>${browserScript}</script>
</body>
</html>`;

await fs.writeFile(outputPath, html, 'utf8');
console.log(`Generated ${path.relative(projectRoot, outputPath)} from ${path.relative(projectRoot, markdownPath)}`);
