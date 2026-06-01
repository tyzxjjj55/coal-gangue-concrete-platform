    (() => {
      const templateData = (() => {
        try {
          return JSON.parse(document.getElementById("workspace-template-data")?.textContent || "{}");
        } catch {
          return {};
        }
      })();
      const escapeAttr = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[char]));
      document.querySelectorAll(".message").forEach((message) => {
        message.setAttribute("role", "status");
        message.title = "点击关闭";
        message.addEventListener("click", () => message.remove());
        window.setTimeout(() => message.remove(), 4000);
      });
      const navLinks = Array.from(document.querySelectorAll(".sidebar-v22 nav a[href^='#']"));
      const navHashFor = (hash) => {
        const value = hash || "#overview";
        if (navLinks.some((link) => link.getAttribute("href") === value)) return value;
        if (/^#record-/.test(value)) return "#block-management";
        if (/^#gangue-/.test(value)) return "#gangue-archive";
        return "#overview";
      };
      const setCurrentNav = (hash) => {
        const current = navHashFor(hash);
        navLinks.forEach((link) => {
          const active = link.getAttribute("href") === current;
          if (active) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      };
      const navSections = navLinks.map((link) => ({
        hash: link.getAttribute("href") || "#overview",
        section: document.querySelector(link.getAttribute("href") || "#overview")
      })).filter((item) => item.section);
      let navScrollFrame = 0;
      const syncCurrentNavFromScroll = () => {
        navScrollFrame = 0;
        const topOffset = Math.min(220, Math.max(120, window.innerHeight * .24));
        const visible = navSections.reduce((current, item) => (
          item.section.getBoundingClientRect().top <= topOffset ? item : current
        ), navSections[0]);
        if (visible) setCurrentNav(visible.hash);
      };
      let closeAllRecordsForNav = () => {};
      navLinks.forEach((link) => link.addEventListener("click", (event) => {
        const targetHash = link.getAttribute("href") || "#overview";
        if (!targetHash.startsWith("#")) return;
        event.preventDefault();
        closeAllRecordsForNav();
        setCurrentNav(targetHash);
        history.pushState(null, "", location.pathname + location.search + targetHash);
        const target = document.querySelector(targetHash);
        if (target) {
          if (target.matches("details")) target.open = true;
          target.closest("details")?.setAttribute("open", "");
          window.setTimeout(() => target.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
        }
      }));
      setCurrentNav(location.hash);
      window.addEventListener("hashchange", () => setCurrentNav(location.hash));
      window.addEventListener("scroll", () => {
        if (navScrollFrame) return;
        navScrollFrame = window.requestAnimationFrame(syncCurrentNavFromScroll);
      }, { passive: true });
      const setOptions = (select, entries, current) => {
        if (!select || !entries) return;
        select.innerHTML = Object.entries(entries).map(([key, item]) => (
          "<option value=\"" + escapeAttr(key) + "\" " + (key === current ? "selected" : "") + ">" + escapeAttr(item.label || key) + "</option>"
        )).join("");
      };
      const fillGradationWeights = (scope, category, templateKey) => {
        const panel = scope.querySelector("[data-gradation-weight-panel]");
        if (!panel) return;
        const scheme = templateData.gradations?.[category] || templateData.gradations?.road;
        const template = scheme?.templates?.[templateKey] || scheme?.templates?.raw;
        const grid = panel.querySelector(".template-weight-grid");
        if (!scheme || !grid) return;
        panel.querySelector("strong").textContent = scheme.label + " · 粒径克数";
        grid.innerHTML = scheme.ranges.map((range, index) => {
          const weight = Array.isArray(template?.weights) ? (template.weights[index] ?? "") : "";
          return "<label><span>" + escapeAttr(range) + "</span><input name=\"blockGradationWeight\" value=\"" + escapeAttr(weight) + "\" placeholder=\"g\"><input type=\"hidden\" name=\"blockGradationRange\" value=\"" + escapeAttr(range) + "\"></label>";
        }).join("");
        const coefficientInput = scope.querySelector("[name='gradationCoefficient']");
        if (coefficientInput) coefficientInput.value = template?.nValue || "";
      };
      const applyWeighingTemplate = (form, templateKey) => {
        const template = templateData.weighing?.[templateKey];
        if (!template || !form) return;
        Object.values(templateData.materialIds || {}).forEach((id) => {
          const input = id ? Array.from(form.elements || []).find((element) => element.name === "recipe_" + id) : null;
          if (input) input.value = "";
        });
        Object.entries(template.values || {}).forEach(([label, amount]) => {
          const id = templateData.materialIds?.[label];
          const input = id ? Array.from(form.elements || []).find((element) => element.name === "recipe_" + id) : null;
          if (input) input.value = amount;
        });
        const total = form.querySelector("[name='totalWithoutWater']");
        if (total) total.value = template.totalWithoutWater || "";
        const applied = form.querySelector("[data-template-applied]");
        if (applied) applied.value = "1";
      };
      const syncTemplateControls = (scope, options = {}) => {
        const categorySelect = scope.querySelector("[data-block-category]");
        const weighingSelect = scope.querySelector("[data-weighing-template]");
        const gradationSelect = scope.querySelector("[data-gradation-template]");
        const category = categorySelect?.value || "spray";
        if (gradationSelect) {
          const current = options.resetGradation ? "raw" : (gradationSelect.value || "raw");
          setOptions(gradationSelect, templateData.gradations?.[category]?.templates, current);
          if (options.resetGradation || options.fillGradation) fillGradationWeights(scope, category, gradationSelect.value || current);
        }
        if (weighingSelect && options.resetWeighing) {
          weighingSelect.value = category === "spray" ? "withAccelerator" : "withoutAccelerator";
          applyWeighingTemplate(scope.tagName === "FORM" ? scope : scope.querySelector("form") || scope, weighingSelect.value);
        }
      };
      const ageInput = document.getElementById("ageInput");
      document.querySelectorAll("[data-age]").forEach((button) => {
        button.addEventListener("click", () => {
          const targetInput = button.dataset.ageTarget ? document.querySelector(button.dataset.ageTarget) : ageInput;
          if (!targetInput) return;
          const values = new Set(targetInput.value.split(/[\s,，、]+/).map((item) => item.trim()).filter(Boolean));
          values.add(button.dataset.age);
          targetInput.value = Array.from(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b).join(",");
        });
      });
      document.querySelectorAll("[data-use-block-code]").forEach((button) => {
        button.addEventListener("click", () => {
          const scope = button.closest("form");
          const input = scope?.querySelector("[data-block-name-input]");
          const suggestion = scope?.querySelector("[data-block-code-suggestion]")?.textContent?.trim();
          if (input && suggestion) input.value = suggestion;
        });
      });

      const search = document.getElementById("blockSearch");
      const globalSearch = document.getElementById("globalBlockSearch");
      const cards = Array.from(document.querySelectorAll("[data-block-card]"));
      const blockFilters = Array.from(document.querySelectorAll("[data-block-filter]"));
      const applySearch = (value) => {
        const keyword = String(value || "").trim().toLowerCase();
        const filters = Object.fromEntries(blockFilters.map((filter) => [filter.dataset.blockFilter, filter.value || ""]));
        cards.forEach((card) => {
          const matchesKeyword = !keyword || (card.dataset.search || "").toLowerCase().includes(keyword);
          const matchesCategory = !filters.category || card.dataset.category === filters.category;
          const matchesGangue = !filters.gangue || card.dataset.gangue === filters.gangue;
          const matchesAge = !filters.age || (card.dataset.ages || "").split(",").includes(filters.age);
          const matchesStrength = !filters.strength || card.dataset.hasStrength === filters.strength;
          const matchesImage = !filters.image || card.dataset.hasImage === filters.image;
          const matchesFailure = !filters.failure || (card.dataset.failureModes || "").includes(filters.failure);
          card.classList.toggle("hidden", !(matchesKeyword && matchesCategory && matchesGangue && matchesAge && matchesStrength && matchesImage && matchesFailure));
        });
      };
      if (search) {
        search.addEventListener("input", () => {
          applySearch(search.value);
          if (globalSearch && globalSearch.value !== search.value) globalSearch.value = search.value;
        });
      }
      if (globalSearch) {
        globalSearch.addEventListener("input", () => {
          applySearch(globalSearch.value);
          if (search && search.value !== globalSearch.value) search.value = globalSearch.value;
        });
      }
      document.querySelector("[data-search-submit]")?.addEventListener("click", () => {
        if (!globalSearch) return;
        applySearch(globalSearch.value);
        globalSearch.focus();
      });
      blockFilters.forEach((filter) => filter.addEventListener("change", () => applySearch(search?.value || globalSearch?.value || "")));
      const calendar = document.getElementById("calendar");
      let applyCalendarFilterExternal = null;
      if (calendar) {
        const calendarFilterLabels = { overdue: "逾期未完成", today: "今天要处理", next7: "未来 7 天", next14: "未来 14 天", completed: "已完成任务" };
        const applyCalendarFilter = (activeFilter = "") => {
          let visibleCount = 0;
          calendar.querySelectorAll("[data-calendar-filter]").forEach((item) => item.classList.toggle("active", Boolean(activeFilter) && item.dataset.calendarFilter === activeFilter));
          calendar.querySelectorAll("[data-calendar-item]").forEach((item) => {
            const tokens = String(item.dataset.calendarTokens || "").split(/\s+/).filter(Boolean);
            const visible = !activeFilter || tokens.includes(activeFilter);
            item.classList.toggle("calendar-filter-hidden", !visible);
            if (visible) visibleCount += 1;
          });
          calendar.querySelectorAll("[data-calendar-day]").forEach((day) => {
            const visibleItems = Array.from(day.querySelectorAll("[data-calendar-item]")).filter((item) => !item.classList.contains("calendar-filter-hidden"));
            day.classList.toggle("calendar-filter-empty-day", Boolean(activeFilter) && visibleItems.length === 0);
          });
          calendar.querySelectorAll("[data-calendar-month]").forEach((month) => {
            const visibleItems = Array.from(month.querySelectorAll("[data-calendar-item]")).filter((item) => !item.classList.contains("calendar-filter-hidden"));
            month.classList.toggle("calendar-filter-empty-month", Boolean(activeFilter) && visibleItems.length === 0);
          });
          const status = calendar.querySelector("[data-calendar-filter-status]");
          const statusText = calendar.querySelector("[data-calendar-filter-text]");
          if (status && statusText) {
            status.hidden = !activeFilter;
            statusText.textContent = activeFilter ? "当前只看：" + (calendarFilterLabels[activeFilter] || activeFilter) + "，共 " + visibleCount + " 条。再次点击数字或点清除可取消。" : "";
          }
          const empty = calendar.querySelector("[data-calendar-filter-empty]");
          if (empty) empty.hidden = !activeFilter || visibleCount > 0;
        };
        applyCalendarFilterExternal = applyCalendarFilter;
        calendar.querySelectorAll("[data-calendar-filter]").forEach((button) => {
          button.addEventListener("click", () => {
            applyCalendarFilter(button.classList.contains("active") ? "" : (button.dataset.calendarFilter || ""));
          });
        });
        calendar.querySelector("[data-calendar-clear-filter]")?.addEventListener("click", () => applyCalendarFilter(""));
      }
      const flashTarget = (target) => {
        if (!target) return;
        target.classList.remove("focus-flash-v39");
        void target.offsetWidth;
        target.classList.add("focus-flash-v39");
        window.setTimeout(() => target.classList.remove("focus-flash-v39"), 1300);
      };
      document.addEventListener("click", (event) => {
        const drilldown = event.target.closest("[data-calendar-drilldown]");
        if (drilldown) {
          event.preventDefault();
          const target = document.getElementById("calendar");
          if (target) {
            history.replaceState(null, "", location.pathname + location.search + "#calendar");
            target.scrollIntoView({ block: "start", behavior: "smooth" });
            window.setTimeout(() => {
              applyCalendarFilterExternal?.(drilldown.dataset.calendarDrilldown || "");
              flashTarget(target);
            }, 80);
          }
          return;
        }
        const focusLink = event.target.closest("[data-focus-target]");
        if (focusLink) {
          const target = document.getElementById(focusLink.dataset.focusTarget || "");
          if (!target) return;
          window.setTimeout(() => flashTarget(target), 180);
        }
      });
      document.querySelectorAll("[data-image-filter-panel]").forEach((panel) => {
        const filters = Array.from(panel.querySelectorAll("[data-image-filter]"));
        const gallery = panel.nextElementSibling;
        const cards = Array.from(gallery?.querySelectorAll("[data-image-card]") || []);
        const applyImageFilters = () => {
          const values = Object.fromEntries(filters.map((filter) => [filter.dataset.imageFilter, filter.value || ""]));
          cards.forEach((card) => {
            const ok = (!values.kind || card.dataset.imageKind === values.kind)
              && (!values.age || card.dataset.imageAge === values.age)
              && (!values.tag || (card.dataset.imageTags || "").includes(values.tag));
            card.classList.toggle("hidden", !ok);
          });
        };
        filters.forEach((filter) => filter.addEventListener("change", applyImageFilters));
      });
      const exportChecks = Array.from(document.querySelectorAll("[data-export-check]"));
      const normalizeResultNumber = (value) => {
        const text = String(value || "").replace(/MPa/ig, "").replace(/，/g, ".").trim();
        if (!text) return "";
        const number = Number.parseFloat(text);
        if (!Number.isFinite(number)) return "";
        return String(Math.round(number * 1000) / 1000);
      };
      const resultCardValues = (card) => {
        const sampleValues = Array.from(card.querySelectorAll("[data-strength-mpa]"))
          .map((input) => normalizeResultNumber(input.value))
          .filter(Boolean);
        if (sampleValues.length) return sampleValues;
        const manual = normalizeResultNumber(card.querySelector("[name^='manualMean_']")?.value || "");
        return manual ? [manual] : [];
      };
      const resultValuesKey = (values) => values.map((value) => normalizeResultNumber(value)).filter(Boolean).join("|");
      const resultValuesLabel = (values) => {
        const normalized = values.map((value) => normalizeResultNumber(value)).filter(Boolean);
        if (!normalized.length) return "空";
        return normalized.map((value) => value + " MPa").join(" / ");
      };
      const changedExistingResults = (form) => Array.from(form.querySelectorAll("[data-result-card]"))
        .map((card) => {
          const initial = JSON.parse(card.dataset.initialResultValues || "[]");
          if (!initial.length) return null;
          const current = resultCardValues(card);
          if (resultValuesKey(initial) === resultValuesKey(current)) return null;
          return {
            label: card.dataset.resultLabel || "测试结果",
            before: resultValuesLabel(initial),
            after: resultValuesLabel(current)
          };
        })
        .filter(Boolean);
      document.querySelectorAll("form[data-record-form]").forEach((form) => {
        form.querySelectorAll("[data-result-card]").forEach((card) => {
          card.dataset.initialResultValues = JSON.stringify(resultCardValues(card));
        });
        form.addEventListener("submit", (event) => {
          const changes = changedExistingResults(form);
          if (!changes.length) return;
          const message = "你正在修改已有强度结果：\n"
            + changes.slice(0, 8).map((item) => item.label + "：由 " + item.before + " 改为 " + item.after).join("\n")
            + (changes.length > 8 ? "\n还有 " + (changes.length - 8) + " 项变化。" : "")
            + "\n\n新增空白结果不会提醒。确定保存这些修改吗？";
          if (!confirm(message)) event.preventDefault();
        });
      });
      document.querySelector("[data-check-all-export]")?.addEventListener("click", () => {
        exportChecks.forEach((input) => {
          const card = input.closest("[data-block-card]");
          if (!card || !card.classList.contains("hidden")) input.checked = true;
        });
      });
      document.querySelector("[data-clear-export]")?.addEventListener("click", () => {
        exportChecks.forEach((input) => { input.checked = false; });
      });
      document.getElementById("exportBlocksForm")?.addEventListener("submit", (event) => {
        const submitter = event.submitter;
        const exportAll = submitter && submitter.name === "exportAll";
        if (!exportAll && !exportChecks.some((input) => input.checked)) {
          event.preventDefault();
          alert("先勾选要导出的试块。");
        }
      });

      const recordDetails = Array.from(document.querySelectorAll("[data-record-details]"));
      const syncRecordDrawerState = () => {
        document.body.classList.toggle("record-drawer-open", recordDetails.some((details) => details.open));
      };
      const clearRecordHash = () => {
        if (/^#record-/.test(location.hash || "")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      };
      const closeRecord = (details) => {
        if (!details) return;
        details.open = false;
        syncRecordDrawerState();
        clearRecordHash();
      };
      closeAllRecordsForNav = () => {
        recordDetails.forEach((details) => { details.open = false; });
        syncRecordDrawerState();
        if (/^#record-/.test(location.hash || "")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      };
      const openRecord = (id, tab) => {
        const details = document.getElementById("record-" + id) || document.querySelector("[data-record-id='" + CSS.escape(id) + "']");
        if (!details) return;
        const folder = details.closest(".gangue-folder");
        if (folder) folder.open = true;
        details.open = true;
        syncRecordDrawerState();
        if (tab) details.querySelector("[data-record-tab='" + CSS.escape(tab) + "']")?.click();
        if (id && location.hash !== "#record-" + id) {
          history.replaceState(null, "", location.pathname + location.search + "#record-" + id);
        }
        setCurrentNav("#record-" + id);
      };
      recordDetails.forEach((details) => {
        const summary = details.querySelector("summary");
        summary?.setAttribute("aria-expanded", details.open ? "true" : "false");
        details.addEventListener("toggle", () => {
          summary?.setAttribute("aria-expanded", details.open ? "true" : "false");
          syncRecordDrawerState();
          if (!details.open) return;
          const folder = details.closest(".gangue-folder");
          (folder ? Array.from(folder.querySelectorAll("[data-record-details]")) : recordDetails)
            .forEach((other) => { if (other !== details) other.open = false; });
        });
        details.querySelectorAll("[data-record-tab]").forEach((button) => {
          button.addEventListener("click", () => {
            const key = button.dataset.recordTab;
            details.querySelectorAll("[data-record-tab]").forEach((item) => item.classList.toggle("active", item === button));
            details.querySelectorAll("[data-record-panel]").forEach((panel) => {
              panel.hidden = panel.dataset.recordPanel !== key;
              panel.classList.toggle("active", panel.dataset.recordPanel === key);
            });
            const activeInput = details.querySelector("[data-active-record-tab-input]");
            if (activeInput) activeInput.value = key || "base";
          });
        });
        details.querySelector("[data-close-record]")?.addEventListener("click", (event) => {
          event.preventDefault();
          closeRecord(details);
        });
        syncTemplateControls(details);
      });
      document.addEventListener("click", (event) => {
        const link = event.target.closest("[data-open-record]");
        if (link) {
          event.preventDefault();
          openRecord(link.dataset.openRecord, link.dataset.recordTabTarget || "");
          return;
        }
        const openDetails = document.querySelector(".record-details[open]");
        if (openDetails && !event.target.closest(".record-drawer-body") && !event.target.closest("summary")) {
          closeRecord(openDetails);
        }
      });
      const initialParams = new URLSearchParams(location.search);
      if (initialParams.get("openBlock")) openRecord(initialParams.get("openBlock"), initialParams.get("tab") || "");
      document.querySelectorAll("form").forEach((form) => {
        syncTemplateControls(form);
        form.querySelector("[data-block-category]")?.addEventListener("change", () => syncTemplateControls(form, { resetWeighing: true, resetGradation: true }));
        form.querySelector("[data-gradation-template]")?.addEventListener("change", (event) => {
          fillGradationWeights(form, form.querySelector("[data-block-category]")?.value || "spray", event.target.value);
        });
        form.querySelector("[data-weighing-template]")?.addEventListener("change", (event) => applyWeighingTemplate(form, event.target.value));
      });
      const bindSpecimenRow = (row) => {
        if (!row || row.dataset.specimenBound === "1") return;
        row.dataset.specimenBound = "1";
        const pressure = row.querySelector("[data-pressure-kn]");
        const area = row.querySelector("[data-area-mm2]");
        const strength = row.querySelector("[data-strength-mpa]");
        const formatNumber = (value) => {
          if (!Number.isFinite(value)) return "";
          return String(Math.round(value * 100) / 100).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
        };
        const updateStrength = () => {
          const pressureValue = Number.parseFloat(String(pressure?.value || "").replace(",", "."));
          const areaValue = Number.parseFloat(String(area?.value || "").replace(",", "."));
          if (!strength || !Number.isFinite(pressureValue) || !Number.isFinite(areaValue) || areaValue <= 0) return;
          strength.value = formatNumber((pressureValue * 1000) / areaValue);
        };
        pressure?.addEventListener("input", updateStrength);
        area?.addEventListener("input", updateStrength);
        updateStrength();
      };
      document.querySelectorAll("[data-specimen-row]").forEach(bindSpecimenRow);
      const updateSpecimenSummary = (table) => {
        const values = Array.from(table.querySelectorAll("[data-strength-mpa]"))
          .map((input) => Number.parseFloat(String(input.value || "").replace(",", ".")))
          .filter(Number.isFinite);
        const summary = table.querySelector("[data-specimen-summary]");
        if (!summary) return;
        const meanSlot = summary.querySelector("[data-mean]");
        const stdSlot = summary.querySelector("[data-std]");
        const cvSlot = summary.querySelector("[data-cv]");
        const minSlot = summary.querySelector("[data-min]");
        const maxSlot = summary.querySelector("[data-max]");
        const nSlot = summary.querySelector("[data-n]");
        const warn = summary.querySelector("[data-cv-warning]");
        if (!values.length) {
          if (meanSlot) meanSlot.textContent = "未录";
          if (stdSlot) stdSlot.textContent = "空";
          if (cvSlot) cvSlot.textContent = "空";
          if (minSlot) minSlot.textContent = "空";
          if (maxSlot) maxSlot.textContent = "空";
          if (nSlot) nSlot.textContent = "空";
          if (warn) warn.hidden = true;
          summary.classList.remove("warn");
          return;
        }
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.length > 1
          ? values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1)
          : 0;
        const std = Math.sqrt(variance);
        const cv = mean ? (std / mean) * 100 : 0;
        const fmt = (value) => String(Math.round(value * 100) / 100).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
        if (meanSlot) meanSlot.textContent = fmt(mean) + " MPa";
        if (stdSlot) stdSlot.textContent = values.length > 1 ? fmt(std) + " MPa" : "空";
        if (cvSlot) cvSlot.textContent = values.length > 1 ? fmt(cv) + "%" : "空";
        if (minSlot) minSlot.textContent = fmt(Math.min(...values)) + " MPa";
        if (maxSlot) maxSlot.textContent = fmt(Math.max(...values)) + " MPa";
        if (nSlot) nSlot.textContent = String(values.length);
        const showWarn = values.length > 1 && cv > 15;
        if (warn) warn.hidden = !showWarn;
        summary.classList.toggle("warn", showWarn);
      };
      document.querySelectorAll(".specimen-table-v22").forEach((table) => {
        table.addEventListener("input", (event) => {
          if (event.target.matches("[data-pressure-kn], [data-area-mm2], [data-strength-mpa]")) {
            window.setTimeout(() => updateSpecimenSummary(table), 0);
          }
        });
        updateSpecimenSummary(table);
      });
      const clearSpecimenRow = (row, index, defaultArea) => {
        row.querySelectorAll("input, select").forEach((field) => {
          if (field.name?.startsWith("sampleSpecimenNo_")) field.value = String(index + 1);
          else if (field.matches("[data-area-mm2]")) field.value = defaultArea || "";
          else if (field.tagName === "SELECT") field.value = "";
          else field.value = "";
        });
      };
      const renumberSpecimenRows = (table) => {
        Array.from(table.querySelectorAll("[data-specimen-row]")).forEach((row, index) => {
          row.querySelectorAll("input, select").forEach((field) => {
            if (field.name) field.name = field.name.replace(/_(\d+)$/, "_" + index);
            if (field.name?.startsWith("sampleSpecimenNo_") && !String(field.value || "").trim()) {
              field.value = String(index + 1);
            }
            field.placeholder = field.placeholder?.replace(/^\d+$/, String(index + 1)) || field.placeholder;
          });
        });
      };
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-add-specimen-row]");
        if (!button) return;
        event.preventDefault();
        const table = button.closest("[data-specimen-table]");
        if (!table) return;
        const rows = Array.from(table.querySelectorAll("[data-specimen-row]"));
        const maxRows = Number.parseInt(table.dataset.maxSpecimens || "12", 10);
        if (rows.length >= maxRows) {
          alert("最多记录 " + maxRows + " 个试件。");
          return;
        }
        const template = rows[rows.length - 1]?.cloneNode(true);
        if (!template) return;
        const nextIndex = rows.length;
        template.dataset.specimenBound = "";
        template.querySelectorAll("input, select").forEach((field) => {
          if (field.name) field.name = field.name.replace(/_(\d+)$/, "_" + nextIndex);
          if (field.name?.startsWith("sampleSpecimenNo_")) field.value = String(nextIndex + 1);
          else if (field.matches("[data-area-mm2]")) field.value = table.dataset.defaultArea || "";
          else if (field.tagName === "SELECT") field.value = "";
          else field.value = "";
        });
        button.before(template);
        renumberSpecimenRows(table);
        bindSpecimenRow(template);
        updateSpecimenSummary(table);
      });
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-specimen-row]");
        if (!button) return;
        event.preventDefault();
        const table = button.closest("[data-specimen-table]");
        const row = button.closest("[data-specimen-row]");
        if (!table || !row) return;
        const rows = Array.from(table.querySelectorAll("[data-specimen-row]"));
        const minRows = 3;
        if (rows.length <= minRows) {
          clearSpecimenRow(row, rows.indexOf(row), table.dataset.defaultArea || "");
        } else {
          row.remove();
        }
        renumberSpecimenRows(table);
        updateSpecimenSummary(table);
      });
      const openRecordFromHash = () => {
        if (!location.hash) return;
        let targetId = "";
        try {
          targetId = decodeURIComponent(location.hash.slice(1));
        } catch {
          targetId = location.hash.slice(1);
        }
        const target = document.getElementById(targetId);
        if (!target) return;
        if (target.matches("details")) target.open = true;
        target.closest("details")?.setAttribute("open", "");
        if (/^record-/.test(targetId)) {
          const details = target.matches("[data-record-details]") ? target : null;
          if (details?.dataset.recordId) {
            openRecord(details.dataset.recordId, "");
            return;
          }
        } else {
          recordDetails.forEach((details) => { details.open = false; });
        }
        window.setTimeout(() => target.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
      };
      document.querySelector("[data-open-all-records]")?.addEventListener("click", () => {
        recordDetails.forEach((details) => { details.open = true; });
        syncRecordDrawerState();
      });
      document.querySelector("[data-close-all-records]")?.addEventListener("click", () => {
        recordDetails.forEach((details) => { details.open = false; });
        syncRecordDrawerState();
        clearRecordHash();
      });
      openRecordFromHash();
      window.addEventListener("hashchange", openRecordFromHash);

      document.querySelectorAll("[data-swipe-dismiss]").forEach((card) => {
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let tracking = false;
        let moved = false;
        const reset = () => {
          tracking = false;
          moved = false;
          currentX = 0;
          card.classList.remove("swiping", "dismiss-ready");
          card.style.transform = "";
        };
        card.addEventListener("pointerdown", (event) => {
          if (event.target.closest("button, a, input, select, textarea, form")) return;
          startX = event.clientX;
          startY = event.clientY;
          currentX = 0;
          tracking = true;
          moved = false;
          card.classList.add("swiping");
        });
        card.addEventListener("pointermove", (event) => {
          if (!tracking) return;
          const dx = event.clientX - startX;
          const dy = event.clientY - startY;
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 18) {
            reset();
            return;
          }
          if (dx > 6) return;
          currentX = Math.max(dx, -150);
          moved = Math.abs(currentX) > 8;
          card.style.transform = "translateX(" + currentX + "px)";
          card.classList.toggle("dismiss-ready", currentX < -86);
        });
        const finish = () => {
          if (!tracking) return;
          if (currentX < -86) {
            const form = card.querySelector("[data-dismiss-form]");
            card.classList.add("dismissing");
            window.setTimeout(() => {
              if (form?.requestSubmit) {
                form.requestSubmit();
              } else {
                form?.submit();
              }
            }, 120);
          } else {
            reset();
          }
        };
        card.addEventListener("pointerup", finish);
        card.addEventListener("pointercancel", reset);
        card.addEventListener("click", (event) => {
          if (moved) event.preventDefault();
        });
      });

      const lightbox = document.createElement("div");
      lightbox.className = "lab-lightbox-v22";
      lightbox.innerHTML = "<button class=\"lab-lightbox-nav-v22 prev\" type=\"button\" aria-label=\"上一张\">‹</button><img alt=\"实验原图\"><button class=\"lab-lightbox-nav-v22 next\" type=\"button\" aria-label=\"下一张\">›</button><div class=\"lab-lightbox-counter-v22\" aria-live=\"polite\"></div><div class=\"lab-lightbox-actions-v22\"><a download>下载原图</a><button type=\"button\" data-lightbox-close>关闭预览</button></div>";
      document.body.appendChild(lightbox);
      const lightboxImage = lightbox.querySelector("img");
      const lightboxDownload = lightbox.querySelector("a");
      const lightboxCounter = lightbox.querySelector(".lab-lightbox-counter-v22");
      const lightboxPrev = lightbox.querySelector(".lab-lightbox-nav-v22.prev");
      const lightboxNext = lightbox.querySelector(".lab-lightbox-nav-v22.next");
      let lightboxItems = [];
      let lightboxIndex = 0;
      let lightboxReturnFocus = null;
      let lightboxScroll = { x: 0, y: 0 };
      let lightboxTouchX = 0;
      const isVisibleLightboxLink = (item) => {
        if (!item?.getAttribute("href")) return false;
        const card = item.closest("[data-image-card]");
        if (card?.classList.contains("hidden")) return false;
        return item.getClientRects().length > 0;
      };
      const setLightboxImage = (index) => {
        if (!lightboxItems.length) return;
        lightboxIndex = (index + lightboxItems.length) % lightboxItems.length;
        const item = lightboxItems[lightboxIndex];
        const href = item.getAttribute("href");
        if (!href) return;
        lightboxImage.src = href;
        lightboxImage.alt = item.querySelector("img")?.alt || "实验原图";
        lightboxDownload.href = item.dataset.download || href;
        if (lightboxCounter) lightboxCounter.textContent = (lightboxIndex + 1) + " / " + lightboxItems.length;
        lightboxPrev.disabled = lightboxItems.length <= 1;
        lightboxNext.disabled = lightboxItems.length <= 1;
      };
      const moveLightbox = (step) => setLightboxImage(lightboxIndex + step);
      const closeLightbox = () => {
        if (!lightbox.classList.contains("active")) return;
        lightbox.classList.remove("active");
        document.body.classList.remove("lab-lightbox-open-v34");
        lightboxImage.removeAttribute("src");
        window.scrollTo(lightboxScroll.x, lightboxScroll.y);
        if (lightboxReturnFocus && document.contains(lightboxReturnFocus)) {
          lightboxReturnFocus.focus({ preventScroll: true });
        }
      };
      lightbox.querySelector("[data-lightbox-close]")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeLightbox();
      });
      lightboxPrev?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveLightbox(-1);
      });
      lightboxNext?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveLightbox(1);
      });
      lightbox.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.target === lightbox) closeLightbox();
      });
      lightboxImage?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (lightboxItems.length > 1) moveLightbox(1);
      });
      lightbox.addEventListener("touchstart", (event) => {
        lightboxTouchX = event.changedTouches?.[0]?.clientX || 0;
      }, { passive: true });
      lightbox.addEventListener("touchend", (event) => {
        const endX = event.changedTouches?.[0]?.clientX || 0;
        const distance = endX - lightboxTouchX;
        if (Math.abs(distance) > 42) moveLightbox(distance > 0 ? -1 : 1);
      }, { passive: true });
      document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("active")) return;
        if (event.key === "Escape") {
          event.preventDefault();
          closeLightbox();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveLightbox(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          moveLightbox(1);
        }
      });
      document.addEventListener("click", (event) => {
        const link = event.target.closest("[data-lightbox-image]");
        if (!link) return;
        if (!link.getAttribute("href")) return;
        event.preventDefault();
        event.stopPropagation();
        const gallery = link.closest(".lab-gallery");
        lightboxItems = Array.from((gallery || document).querySelectorAll("[data-lightbox-image]"))
          .filter(isVisibleLightboxLink);
        const index = Math.max(0, lightboxItems.indexOf(link));
        lightboxReturnFocus = link;
        lightboxScroll = { x: window.scrollX, y: window.scrollY };
        setLightboxImage(index);
        lightbox.classList.add("active");
        document.body.classList.add("lab-lightbox-open-v34");
      });

      document.querySelectorAll(".delete-block").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (!confirm("确定删除这条试块记录吗？")) event.preventDefault();
        });
      });
      document.querySelectorAll(".delete-lab-image").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (!confirm("确定删除这张实验图片吗？")) event.preventDefault();
        });
      });

      document.querySelectorAll("[data-lab-upload]").forEach((form) => {
        form.addEventListener("submit", (event) => {
          const input = form.querySelector("input[type=file]");
          const files = Array.from(input?.files || []);
          if (!files.length || !window.XMLHttpRequest) return;
          event.preventDefault();
          const progress = form.querySelector("[data-upload-progress]");
          const bar = form.querySelector("[data-upload-bar]");
          const text = form.querySelector("[data-upload-text]");
          const button = form.querySelector("button[type=submit]");
          const xhr = new XMLHttpRequest();
          xhr.open("POST", form.action);
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
          if (progress) progress.classList.add("active");
          if (button) {
            button.disabled = true;
            button.textContent = "上传中...";
          }
          xhr.upload.onprogress = (progressEvent) => {
            if (!progressEvent.lengthComputable) return;
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            if (bar) bar.style.width = percent + "%";
            if (text) text.textContent = "正在上传 " + files.length + " 张图片：" + percent + "%";
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const targetType = form.querySelector("[name='targetType']")?.value || "";
              const targetId = form.querySelector("[name='targetId']")?.value || "";
              const params = new URLSearchParams();
              params.set("msg", files.length + " 张实验图片已上传");
              if (targetType === "block" && targetId) {
                params.set("openBlock", targetId);
                params.set("tab", "images");
              }
              const hash = targetType === "block" && targetId ? "#record-" + encodeURIComponent(targetId)
                : targetType === "gangue" && targetId ? "#gangue-" + encodeURIComponent(targetId)
                  : location.hash;
              window.location.href = location.pathname + "?" + params.toString() + hash;
              return;
            }
            if (text) text.textContent = "上传失败，请重试";
            if (button) {
              button.disabled = false;
              button.textContent = "重新上传";
            }
          };
          xhr.onerror = () => {
            if (text) text.textContent = "网络中断，上传失败";
            if (button) {
              button.disabled = false;
              button.textContent = "重新上传";
            }
          };
          xhr.send(new FormData(form));
        });
      });
    })();
  
