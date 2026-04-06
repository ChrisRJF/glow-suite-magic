import { formatEuro } from "./data";

export function exportCSV(headers: string[], rows: string[][], filename: string) {
  const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}

export function exportExcel(headers: string[], rows: string[][], filename: string) {
  // Simple XML-based Excel export
  let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Worksheet ss:Name="Rapport"><Table>';
  xml += '<Row>' + headers.map(h => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('') + '</Row>';
  rows.forEach(row => {
    xml += '<Row>' + row.map(c => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`).join('') + '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  downloadBlob(blob, filename);
}

export function exportPDF(title: string, headers: string[], rows: string[][], filename: string) {
  // Generate a clean printable HTML and trigger print dialog
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>
  body{font-family:Arial,sans-serif;margin:40px;color:#1a1a1a}
  h1{font-size:22px;margin-bottom:4px;color:#7B61FF}
  .sub{font-size:12px;color:#666;margin-bottom:24px}
  .brand{font-size:10px;color:#999;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px 12px;border-bottom:2px solid #7B61FF;font-weight:600;color:#333}
  td{padding:8px 12px;border-bottom:1px solid #eee}
  tr:nth-child(even){background:#fafafa}
  .footer{margin-top:24px;font-size:10px;color:#999;text-align:center}
</style></head><body>
<div class="brand">GlowSuite · Salon Business System</div>
<h1>${title}</h1>
<div class="sub">Gegenereerd op ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="footer">© ${new Date().getFullYear()} GlowSuite — Dit rapport is automatisch gegenereerd</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
