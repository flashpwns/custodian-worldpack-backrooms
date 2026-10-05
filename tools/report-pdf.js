"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Escapes characters for PDF literal strings enclosed in parentheses.
 */
function escapePdfText(str) {
  if (str == null) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Encodes a string for PDF text operators (Tj).
 * For ASCII-only strings, returns literal string in parentheses with proper escaping.
 * For strings containing non-ASCII / Unicode characters, returns a UTF-16BE hex string (<FEFF...>).
 */
function encodePdfText(str) {
  if (str == null) return "()";
  const s = String(str);
  const hasNonAscii = /[^\x20-\x7E]/.test(s);
  if (!hasNonAscii) {
    return `(${escapePdfText(s)})`;
  }
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    hex += code.toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

/**
 * Wraps text into lines that fit within maxChars.
 */
function wrapText(text, maxChars = 75) {
  if (!text) return [];
  const paragraphs = String(text).split(/\r?\n/);
  const result = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      result.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxChars) {
        currentLine += " " + word;
      } else {
        result.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }
  return result;
}

/**
 * Pure Node PDF Document Builder
 * Emits standards-compliant PDF 1.4 with Type 1 fonts (Helvetica, Helvetica-Bold, Courier).
 */
class PdfDocument {
  constructor({ pageSize = [612, 792], margins = { top: 45, bottom: 45, left: 45, right: 45 } } = {}) {
    this.pageWidth = pageSize[0];
    this.pageHeight = pageSize[1];
    this.margins = margins;
    this.pages = [];
    this.currentPage = null;
    this.newPage();
  }

  newPage() {
    this.currentPage = {
      stream: [],
      y: this.pageHeight - this.margins.top
    };
    this.pages.push(this.currentPage);
    return this.currentPage;
  }

  ensureSpace(neededPt) {
    if (this.currentPage.y - neededPt < this.margins.bottom) {
      this.newPage();
    }
  }

  setFont(fontName, size) {
    this.currentFont = fontName;
    this.currentFontSize = size;
  }

  setColor(r, g, b) {
    this.currentPage.stream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  setStrokeColor(r, g, b) {
    this.currentPage.stream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  }

  drawRect(x, y, w, h, { fill = false, stroke = true, lineWidth = 1 } = {}) {
    this.currentPage.stream.push(`${lineWidth.toFixed(2)} w`);
    const op = fill && stroke ? "B" : fill ? "f" : "S";
    this.currentPage.stream.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
  }

  drawLine(x1, y1, x2, y2, { lineWidth = 1 } = {}) {
    this.currentPage.stream.push(`${lineWidth.toFixed(2)} w`);
    this.currentPage.stream.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  drawText(text, x, y, { font = this.currentFont || "F1", size = this.currentFontSize || 10, align = "left" } = {}) {
    const encoded = encodePdfText(text);
    this.currentPage.stream.push("BT");
    this.currentPage.stream.push(`/${font} ${size} Tf`);
    let drawX = x;
    if (align === "right") {
      const approxWidth = text.length * size * (font.startsWith("F3") || font.startsWith("F4") ? 0.6 : 0.52);
      drawX = x - approxWidth;
    } else if (align === "center") {
      const approxWidth = text.length * size * (font.startsWith("F3") || font.startsWith("F4") ? 0.6 : 0.52);
      drawX = x - approxWidth / 2;
    }
    this.currentPage.stream.push(`1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm`);
    this.currentPage.stream.push(`${encoded} Tj`);
    this.currentPage.stream.push("ET");
  }

  addTextLine(text, { font = "F1", size = 10, indent = 0, lineHeight = size * 1.35, color = [0, 0, 0] } = {}) {
    this.ensureSpace(lineHeight);
    this.setColor(color[0], color[1], color[2]);
    const x = this.margins.left + indent;
    this.drawText(text, x, this.currentPage.y - size, { font, size });
    this.currentPage.y -= lineHeight;
  }

  addParagraph(text, { font = "F1", size = 10, indent = 0, lineHeight = size * 1.35, color = [0, 0, 0], maxChars = 76 } = {}) {
    const lines = wrapText(text, maxChars);
    for (const line of lines) {
      if (line === "") {
        this.currentPage.y -= lineHeight * 0.5;
        continue;
      }
      this.addTextLine(line, { font, size, indent, lineHeight, color });
    }
  }

  buildBuffer() {
    const objects = [];

    function addObject(content) {
      const objNum = objects.length + 1;
      const body = typeof content === "function" ? content(objNum) : content;
      const str = `${objNum} 0 obj\n${body}\nendobj\n`;
      objects.push(str);
      return objNum;
    }

    const fontHelvetica = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
    const fontHelveticaBold = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);
    const fontCourier = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`);
    const fontCourierBold = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>`);

    const pageObjNums = [];
    const contentObjNums = [];
    const pagesObjNum = 4 + (this.pages.length * 2) + 1;

    for (let i = 0; i < this.pages.length; i++) {
      const pNum = objects.length + 1 + (i * 2);
      const cNum = pNum + 1;
      pageObjNums.push(pNum);
      contentObjNums.push(cNum);
    }

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const pageIndex = i + 1;
      const totalPages = this.pages.length;

      page.stream.push("BT");
      page.stream.push(`/F3 8 Tf`);
      page.stream.push(`0.4 0.4 0.4 rg`);
      page.stream.push(`1 0 0 1 45 ${this.pageHeight - 25} Tm`);
      page.stream.push(`(ASYNC RESEARCH FOUNDATION // RESTRICTED DOCUMENTATION // CQ4-D1) Tj`);
      page.stream.push(`1 0 0 1 ${this.pageWidth - 110} 25 Tm`);
      page.stream.push(`(PAGE ${pageIndex} OF ${totalPages}) Tj`);
      page.stream.push("ET");

      const streamContent = page.stream.join("\n");
      const streamLen = Buffer.byteLength(streamContent, "utf8");

      addObject((objNum) => `<<
  /Type /Page
  /Parent ${pagesObjNum} 0 R
  /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}]
  /Contents ${contentObjNums[i]} 0 R
  /Resources <<
    /Font <<
      /F1 ${fontHelvetica} 0 R
      /F2 ${fontHelveticaBold} 0 R
      /F3 ${fontCourier} 0 R
      /F4 ${fontCourierBold} 0 R
    >>
  >>
>>`);

      addObject((objNum) => `<<
  /Length ${streamLen}
>>
stream
${streamContent}
endstream`);
    }

    const createdPagesObjNum = addObject((objNum) => `<<
  /Type /Pages
  /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}]
  /Count ${pageObjNums.length}
>>`);

    const catalogObjNum = addObject((objNum) => `<<
  /Type /Catalog
  /Pages ${createdPagesObjNum} 0 R
>>`);

    let pdf = `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`;
    const offsets = [];
    offsets.push(0);

    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += objects[i];
    }

    const startXref = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += `0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      const off = String(offsets[i]).padStart(10, "0");
      pdf += `${off} 00000 n \n`;
    }

    pdf += `trailer\n<<\n  /Size ${objects.length + 1}\n  /Root ${catalogObjNum} 0 R\n>>\n`;
    pdf += `startxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(pdf, "utf8");
  }
}

/**
 * Formats report and canonical expedition data into an institutional PDF document.
 */
function generateReportPdf(reportData = {}, options = {}) {
  const doc = new PdfDocument();
  const width = doc.pageWidth - doc.margins.left - doc.margins.right;

  const report = reportData.report ?? {};
  const assessment = report.institutional_assessment ?? reportData.assessment ?? {};
  const basis = assessment.basis ?? {};
  const expedition = reportData.expedition ?? {};
  const team = expedition.team?.members ?? reportData.team ?? [];
  const mission = expedition.mission ?? reportData.mission ?? {};
  const worldId = reportData.world_id ?? reportData.world?.id ?? "UNKNOWN-WORLD";
  const runId = reportData.run_id ?? report.run_id ?? "UNKNOWN-RUN";
  const missionId = report.mission_id ?? mission.id ?? "CQ4-DAY1-0001";
  const author = report.author ?? "TEAM LEAD";

  // --- HEADER SECTION ---
  doc.setColor(0.12, 0.15, 0.2);
  doc.drawRect(doc.margins.left, doc.currentPage.y - 58, width, 58, { fill: true, stroke: false });

  doc.setColor(1, 1, 1);
  doc.drawText("ASYNC RESEARCH FOUNDATION", doc.margins.left + 14, doc.currentPage.y - 20, { font: "F2", size: 13 });
  doc.drawText("FIELD OPERATIONS DIVISION // CLEAR-Q4 SURVEY ARCHIVE", doc.margins.left + 14, doc.currentPage.y - 34, { font: "F1", size: 8 });
  doc.drawText("OFFICIAL EXPEDITION RECORD & INSTITUTIONAL FINDINGS", doc.margins.left + 14, doc.currentPage.y - 48, { font: "F3", size: 9 });

  doc.setColor(0.85, 0.85, 0.85);
  doc.drawText("CLASSIFICATION: RESTRICTED", doc.margins.left + width - 14, doc.currentPage.y - 22, { font: "F4", size: 8, align: "right" });
  doc.drawText("DATE: JULY 17, 1991", doc.margins.left + width - 14, doc.currentPage.y - 36, { font: "F4", size: 8, align: "right" });
  doc.drawText("FORM CQ4-EX-101", doc.margins.left + width - 14, doc.currentPage.y - 48, { font: "F3", size: 8, align: "right" });

  doc.currentPage.y -= 70;

  // --- METADATA TABLE ---
  doc.setStrokeColor(0.7, 0.7, 0.7);
  doc.drawRect(doc.margins.left, doc.currentPage.y - 62, width, 62, { stroke: true, lineWidth: 1 });
  doc.drawLine(doc.margins.left, doc.currentPage.y - 31, doc.margins.left + width, doc.currentPage.y - 31, { lineWidth: 0.5 });
  doc.drawLine(doc.margins.left + (width / 3), doc.currentPage.y, doc.margins.left + (width / 3), doc.currentPage.y - 62, { lineWidth: 0.5 });
  doc.drawLine(doc.margins.left + (2 * width / 3), doc.currentPage.y, doc.margins.left + (2 * width / 3), doc.currentPage.y - 62, { lineWidth: 0.5 });

  const col1 = doc.margins.left + 8;
  const col2 = doc.margins.left + (width / 3) + 8;
  const col3 = doc.margins.left + (2 * width / 3) + 8;

  // Row 1
  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("MISSION IDENTIFIER", col1, doc.currentPage.y - 12, { font: "F4", size: 7 });
  doc.setColor(0, 0, 0);
  doc.drawText(missionId, col1, doc.currentPage.y - 24, { font: "F3", size: 9 });

  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("DEPLOYMENT DATE / WINDOW", col2, doc.currentPage.y - 12, { font: "F4", size: 7 });
  doc.setColor(0, 0, 0);
  doc.drawText("JULY 17, 1991 (10:00 - 12:00)", col2, doc.currentPage.y - 24, { font: "F3", size: 9 });

  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("RECORD STATUS", col3, doc.currentPage.y - 12, { font: "F4", size: 7 });
  doc.setColor(0.1, 0.5, 0.2);
  doc.drawText("COMMITTED TO WORLD ARCHIVE", col3, doc.currentPage.y - 24, { font: "F2", size: 8 });

  // Row 2
  const r2Y = doc.currentPage.y - 31;
  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("OPERATIONAL RUN ID", col1, r2Y - 12, { font: "F4", size: 7 });
  doc.setColor(0, 0, 0);
  doc.drawText(runId.slice(0, 24), col1, r2Y - 24, { font: "F3", size: 8 });

  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("SUBMITTING AUTHOR", col2, r2Y - 12, { font: "F4", size: 7 });
  doc.setColor(0, 0, 0);
  doc.drawText(String(author).slice(0, 28), col2, r2Y - 24, { font: "F1", size: 8 });

  doc.setColor(0.4, 0.4, 0.4);
  doc.drawText("REPORT IDENTIFIER", col3, r2Y - 12, { font: "F4", size: 7 });
  doc.setColor(0, 0, 0);
  doc.drawText((report.id ?? "REPORT-COMMITTED").slice(0, 22), col3, r2Y - 24, { font: "F3", size: 8 });

  doc.currentPage.y -= 75;

  // --- SECTION 1: PERSONNEL ACCOUNTABILITY ---
  doc.setColor(0.2, 0.2, 0.2);
  doc.addTextLine("1. PERSONNEL ACCOUNTABILITY & CUSTODY", { font: "F2", size: 10, lineHeight: 14 });
  doc.setStrokeColor(0.2, 0.2, 0.2);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 1 });
  doc.currentPage.y -= 8;

  if (team.length) {
    for (const member of team) {
      const name = member.display_name ?? member.first_name ?? "Assignee";
      const role = member.role ?? "Field Personnel";
      const status = member.status ?? "accounted for / returned";
      doc.addTextLine(`\u2022  ${name} (${role}) \u2014 STATUS: ${status.toUpperCase()}`, { font: "F1", size: 8.5, indent: 8, lineHeight: 12 });
    }
  } else {
    doc.addTextLine("\u2022  Assigned Clear-Q4 Expedition Personnel accounted for at KV31 return.", { font: "F1", size: 8.5, indent: 8, lineHeight: 12 });
  }

  doc.currentPage.y -= 8;

  // --- SECTION 2: MISSION OBJECTIVE & OPERATIONAL PREREQUISITES ---
  doc.ensureSpace(60);
  doc.setColor(0.2, 0.2, 0.2);
  doc.addTextLine("2. OPERATIONAL ASSIGNMENT & DELIVERABLES", { font: "F2", size: 10, lineHeight: 14 });
  doc.setStrokeColor(0.2, 0.2, 0.2);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 1 });
  doc.currentPage.y -= 8;

  const primaryObj = mission.primary ?? "Delivery of startup prerequisite materials to Outpost A (Bermuda branch) and introductory reconnaissance.";
  doc.addParagraph(`Primary Directive: ${primaryObj}`, { font: "F1", size: 8.5, indent: 8, lineHeight: 11.5 });

  const duffleStatus = basis.duffle_recovered ? "CONFIRMED DEPOSITED AT OUTPOST A" : "NOT RETURNED / STATUS UNVERIFIED";
  const returnStatus = basis.return_verified ? "VERIFIED VIA CONTROL ROOM SURVEILLANCE" : "RECORDED AT THRESHOLD RECONCILIATION";
  doc.addTextLine(`\u2022  Startup Prerequisite Materials: ${duffleStatus}`, { font: "F3", size: 8, indent: 8, lineHeight: 11 });
  doc.addTextLine(`\u2022  Threshold Return Surveillance: ${returnStatus}`, { font: "F3", size: 8, indent: 8, lineHeight: 11 });
  if (basis.is_late) {
    doc.addTextLine(`\u2022  Operational Timing Notice: Return occurred after 12:00 noon cutoff (LATE RETURN RECORDED).`, { font: "F3", size: 8, indent: 8, lineHeight: 11, color: [0.7, 0.1, 0.1] });
  }

  doc.currentPage.y -= 8;

  // --- SECTION 3: PLAYER SUBMITTED FIELD ACCOUNT ---
  doc.ensureSpace(100);
  doc.setColor(0.2, 0.2, 0.2);
  doc.addTextLine("3. SUBMITTED FIELD ACCOUNT (DIRECT WRITTEN CLAIM)", { font: "F2", size: 10, lineHeight: 14 });
  doc.setStrokeColor(0.2, 0.2, 0.2);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 1 });
  doc.currentPage.y -= 8;

  const bodyText = report.text || "No descriptive narrative was recorded by the expedition team.";
  doc.setColor(0.96, 0.96, 0.94);
  doc.drawRect(doc.margins.left + 4, doc.currentPage.y - 8, width - 8, 8, { fill: true, stroke: false });
  doc.addParagraph(`"${bodyText}"`, { font: "F1", size: 8.5, indent: 12, lineHeight: 12, color: [0.1, 0.1, 0.1] });

  doc.currentPage.y -= 8;

  // --- SECTION 4: RETURNED EVIDENCE & ARCHIVAL LOG ---
  doc.ensureSpace(60);
  doc.setColor(0.2, 0.2, 0.2);
  doc.addTextLine("4. RETURNED EVIDENCE RECORDS & EXPOSURE LOG", { font: "F2", size: 10, lineHeight: 14 });
  doc.setStrokeColor(0.2, 0.2, 0.2);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 1 });
  doc.currentPage.y -= 8;

  const evIds = report.available_evidence_ids ?? basis.evidence_ids ?? [];
  if (evIds.length) {
    doc.addTextLine(`Archived Evidence Items (${evIds.length} custody entries):`, { font: "F2", size: 8.5, indent: 8, lineHeight: 11 });
    for (const id of evIds) {
      doc.addTextLine(`\u2022  [EVIDENCE RECORD] ${id}`, { font: "F3", size: 8, indent: 16, lineHeight: 10.5 });
    }
  } else {
    doc.addTextLine("No physical specimens or media records were formally deposited to Evidence Intake.", { font: "F1", size: 8.5, indent: 8, lineHeight: 11 });
  }

  doc.currentPage.y -= 8;

  // --- SECTION 5: INSTITUTIONAL ASSESSMENT & OVERSIGHT DETERMINATION ---
  doc.ensureSpace(80);
  doc.setColor(0.2, 0.2, 0.2);
  doc.addTextLine("5. INSTITUTIONAL ASSESSMENT & OVERSIGHT DETERMINATION", { font: "F2", size: 10, lineHeight: 14 });
  doc.setStrokeColor(0.2, 0.2, 0.2);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 1 });
  doc.currentPage.y -= 8;

  const assessmentStatus = (assessment.status ?? "INSPECTION_COMMITTED").toUpperCase();
  const summaryText = assessment.summary ?? "The submitted written record has been formally catalogued. Personnel returned within authorized operational bounds.";

  doc.setColor(0.15, 0.15, 0.15);
  doc.drawRect(doc.margins.left + 4, doc.currentPage.y - 20, width - 8, 20, { fill: true, stroke: false });
  doc.setColor(1, 1, 1);
  doc.drawText(`DETERMINATION: ${assessmentStatus}`, doc.margins.left + 12, doc.currentPage.y - 14, { font: "F2", size: 8.5 });
  doc.currentPage.y -= 26;

  doc.addParagraph(summaryText, { font: "F1", size: 8.5, indent: 8, lineHeight: 12 });

  doc.currentPage.y -= 14;
  doc.setStrokeColor(0.5, 0.5, 0.5);
  doc.drawLine(doc.margins.left, doc.currentPage.y, doc.margins.left + width, doc.currentPage.y, { lineWidth: 0.5 });
  doc.currentPage.y -= 12;

  // Sign-off box
  doc.setColor(0.3, 0.3, 0.3);
  doc.drawText("AUTHORIZED ARCHIVAL OVERSIGHT: DR. KIRK MAXWELL", doc.margins.left + 8, doc.currentPage.y, { font: "F4", size: 7.5 });
  doc.drawText("STANDBY STATUS: NO FURTHER ASSIGNMENT ISSUED (SHIFT CONCLUDED)", doc.margins.left + width - 8, doc.currentPage.y, { font: "F4", size: 7.5, align: "right" });

  return doc.buildBuffer();
}

/**
 * Convenience helper to write PDF directly to a file path.
 */
function writeReportPdf(reportData, destinationPath, options = {}) {
  const buffer = generateReportPdf(reportData, options);
  const dir = path.dirname(destinationPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destinationPath, buffer);
  return {
    ok: true,
    destination: destinationPath,
    byte_length: buffer.length
  };
}

module.exports = {
  PdfDocument,
  escapePdfText,
  encodePdfText,
  wrapText,
  generateReportPdf,
  writeReportPdf
};
