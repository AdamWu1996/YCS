'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { getAllStaffProfiles, getTaskIdByCodes } from '@/actions/upload/queries';
import { importTimeRecords, ImportTimeRecord } from '@/actions/upload/import';
import { toast } from 'sonner';

type ExcelCell = string | number | Date | null | undefined;

const REQUIRED_HEADER_DEFINITIONS = [
  { key: '姓名', keywords: ['廠商姓名', '廠商名稱', '姓名', '執行人員'] },
  { key: '日期', keywords: ['日期', 'date'] },
  { key: '廠區', keywords: ['廠區', '場區', '所屬廠區', 'location'] },
  {
    key: '進場時間',
    keywords: [
      '進場時間',
      '進場',
      '入廠時間',
      '入廠',
      '實際入廠時間',
      '實際入廠日期時間',
      '入廠日期時間',
      'start time',
      'starttime',
    ],
  },
  {
    key: '出場時間',
    keywords: [
      '出場時間',
      '出場',
      '出廠時間',
      '出廠',
      '實際出廠時間',
      '實際出廠日期時間',
      '出廠日期時間',
      'end time',
      'endtime',
    ],
  },
] as const;

type RequiredHeaderKey = (typeof REQUIRED_HEADER_DEFINITIONS)[number]['key'];

const normalizeHeader = (value: string) =>
  value.replace(/\s+/g, '').trim().toLowerCase();

const buildHeaderMap = (headers: string[]) => {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));
  const map: Partial<Record<RequiredHeaderKey, string>> = {};

  for (const definition of REQUIRED_HEADER_DEFINITIONS) {
    const keywords = definition.keywords.map((keyword) => normalizeHeader(keyword));
    const exactMatch = normalizedHeaders.find((header) =>
      keywords.includes(header.normalized)
    );
    const fuzzyMatch =
      exactMatch ||
      normalizedHeaders.find((header) =>
        keywords.some((keyword) => header.normalized.includes(keyword))
      );

    if (fuzzyMatch) {
      map[definition.key] = fuzzyMatch.raw;
    }
  }

  const missing = REQUIRED_HEADER_DEFINITIONS
    .map((definition) => definition.key)
    .filter((key) => !map[key]);

  return { map, missing };
};

const getCellValue = (row: Record<string, ExcelCell>, key?: string): ExcelCell =>
  key ? row[key] : undefined;

const buildHeaderSignature = (headers: string[]) =>
  headers.map((header) => normalizeHeader(header)).sort().join('|');

const loadStoredHeaderMap = (
  signature: string,
  headers: string[]
): Partial<Record<RequiredHeaderKey, string>> | null => {
  try {
    const raw = localStorage.getItem(`upload-header-map:${signature}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Record<RequiredHeaderKey, string>>;
    const headerSet = new Set(headers);
    const cleaned: Partial<Record<RequiredHeaderKey, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value && headerSet.has(value)) {
        cleaned[key as RequiredHeaderKey] = value;
      }
    }
    return cleaned;
  } catch {
    return null;
  }
};

const persistHeaderMap = (
  signature: string,
  map: Partial<Record<RequiredHeaderKey, string>>
) => {
  try {
    localStorage.setItem(`upload-header-map:${signature}`, JSON.stringify(map));
  } catch {
    // 忽略 localStorage 失敗
  }
};

const getMissingRequiredKeys = (
  map: Partial<Record<RequiredHeaderKey, string>>
) => {
  const missing = REQUIRED_HEADER_DEFINITIONS.map((definition) => definition.key).filter(
    (key) => !map[key]
  );
  return missing.filter((key) => {
    if (key === '出場時間') {
      return false;
    }
    if (key === '日期') {
      return !map.進場時間;
    }
    return true;
  });
};

/**
 * Excel 解析後的原始資料型別
 */
interface ParsedExcelRow {
  姓名: ExcelCell;
  日期: ExcelCell;
  廠區: ExcelCell;
  進場時間: ExcelCell;
  出場時間: ExcelCell;
  專案代碼?: ExcelCell;
  任務代碼?: ExcelCell;
}

/**
 * 預覽表格的資料型別（含匹配狀態）
 */
interface PreviewRow extends ParsedExcelRow {
  matchedStaffId: string | null;
  matchedStaffName: string | null;
  matchStatus: 'matched' | 'unmatched' | 'manual';
  taskId: string | null;
}

const buildPreviewRows = (
  rows: Record<string, ExcelCell>[],
  map: Partial<Record<RequiredHeaderKey, string>>,
  staffList: Array<{ id: string; name: string }>,
  matcher: (
    excelName: ExcelCell,
    list: Array<{ id: string; name: string }>
  ) => { id: string; name: string } | null
): PreviewRow[] =>
  rows.map((row) => {
    const mappedRow: ParsedExcelRow = {
      姓名: getCellValue(row, map.姓名),
      日期: getCellValue(row, map.日期) ?? getCellValue(row, map.進場時間),
      廠區: getCellValue(row, map.廠區),
      進場時間: getCellValue(row, map.進場時間),
      出場時間: getCellValue(row, map.出場時間),
    };
    const matched = matcher(mappedRow.姓名, staffList);
    return {
      ...mappedRow,
      matchedStaffId: matched?.id || null,
      matchedStaffName: matched?.name || null,
      matchStatus: matched ? 'matched' : 'unmatched',
      taskId: null,
    };
  });

/**
 * Excel 匯入頁面
 */
export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [staffProfiles, setStaffProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, ExcelCell>[]>([]);
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [headerMap, setHeaderMap] = useState<Partial<Record<RequiredHeaderKey, string>>>({});
  const [headerSignature, setHeaderSignature] = useState<string | null>(null);
  const [projectCode, setProjectCode] = useState('');
  const [taskCode, setTaskCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // 載入員工資料
  const loadStaffProfiles = async () => {
    const result = await getAllStaffProfiles();
    if (result.success && result.data) {
      setStaffProfiles(result.data);
      return result.data;
    }
    toast.error('載入員工資料失敗');
    return [];
  };

  // 姓名匹配邏輯（自動比對）
  const matchStaffName = (
    excelName: ExcelCell,
    staffList: Array<{ id: string; name: string }>
  ): { id: string; name: string } | null => {
    if (typeof excelName !== 'string') {
      return null;
    }
    const trimmedName = excelName.trim();
    if (!trimmedName) {
      return null;
    }
    // 移除空格並轉小寫進行比對
    const normalizedExcelName = trimmedName.toLowerCase();

    // 完全匹配
    const exactMatch = staffList.find(
      (staff) => staff.name.trim().toLowerCase() === normalizedExcelName
    );
    if (exactMatch) return exactMatch;

    // 部分匹配（Excel 名稱包含在 staff 名稱中，或相反）
    const partialMatch = staffList.find((staff) => {
      const normalizedStaffName = staff.name.trim().toLowerCase();
      return (
        normalizedStaffName.includes(normalizedExcelName) ||
        normalizedExcelName.includes(normalizedStaffName)
      );
    });
    if (partialMatch) return partialMatch;

    return null;
  };

  // 處理 Excel 檔案上傳
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);

    try {
      // 載入員工資料
      const staffList = await loadStaffProfiles();

      // 讀取 Excel
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, ExcelCell>>(firstSheet, {
        defval: null,
      });

      if (jsonData.length === 0) {
        toast.error('Excel 檔案為空');
        setIsLoading(false);
        return;
      }

      const headers = Object.keys(jsonData[0] ?? {});
      const { map } = buildHeaderMap(headers);
      const signature = buildHeaderSignature(headers);
      const storedMap = loadStoredHeaderMap(signature, headers);
      const resolvedMap = {
        ...map,
        ...(storedMap || {}),
      };

      setAvailableHeaders(headers);
      setRawRows(jsonData);
      setHeaderMap(resolvedMap);
      setHeaderSignature(signature);

      const previewRows = buildPreviewRows(jsonData, resolvedMap, staffList, matchStaffName);
      setPreviewData(previewRows);

      const missingRequired = getMissingRequiredKeys(resolvedMap);
      if (missingRequired.length > 0) {
        toast.error(`缺少必要欄位: ${missingRequired.join('、')}，請於欄位對應修正`);
      } else {
        toast.success(`已解析 ${previewRows.length} 筆資料`);
      }
    } catch (error) {
      console.error('解析 Excel 失敗:', error);
      const message = error instanceof Error ? error.message : '';
      toast.error(message ? `資料格式解析錯誤: ${message}` : '資料格式解析錯誤');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHeaderMappingChange = (key: RequiredHeaderKey, value: string) => {
    const nextMap: Partial<Record<RequiredHeaderKey, string>> = {
      ...headerMap,
      [key]: value || undefined,
    };
    setHeaderMap(nextMap);
    if (headerSignature) {
      persistHeaderMap(headerSignature, nextMap);
    }
    const previewRows = buildPreviewRows(rawRows, nextMap, staffProfiles, matchStaffName);
    setPreviewData(previewRows);
  };

  // 手動選擇員工
  const handleStaffSelect = (index: number, staffId: string) => {
    const staff = staffProfiles.find((s) => s.id === staffId);
    if (!staff) return;

    const updated = [...previewData];
    updated[index] = {
      ...updated[index],
      matchedStaffId: staff.id,
      matchedStaffName: staff.name,
      matchStatus: 'manual',
    };
    setPreviewData(updated);
  };

  const pad2 = (value: number) => String(value).padStart(2, '0');
  const timeOnlyPattern = /^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/;

  const isTimeOnlyValue = (value: ExcelCell) => {
    if (typeof value === 'number') {
      return value > 0 && value < 1;
    }
    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      const month = value.getUTCMonth();
      const day = value.getUTCDate();
      return (
        (year === 1899 && month === 11 && day === 30) ||
        (year === 1970 && month === 0 && day === 1)
      );
    }
    if (typeof value === 'string') {
      return timeOnlyPattern.test(value);
    }
    return false;
  };

  // 解析完整日期時間
  const parseDateTime = (value: ExcelCell, isDate: boolean = false): string => {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return isDate ? value.toISOString().split('T')[0] : value.toISOString();
    }
    if (typeof value === 'number') {
      if (value > 0 && value < 1) {
        return '';
      }
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        const d = new Date(
          Date.UTC(
            parsed.y,
            parsed.m - 1,
            parsed.d,
            parsed.H || 0,
            parsed.M || 0,
            parsed.S || 0
          )
        );
        return isDate ? d.toISOString().split('T')[0] : d.toISOString();
      }
      const fallback = new Date(value);
      if (!isNaN(fallback.getTime())) {
        return isDate ? fallback.toISOString().split('T')[0] : fallback.toISOString();
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || timeOnlyPattern.test(trimmed)) {
        return '';
      }
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return isDate ? parsed.toISOString().split('T')[0] : parsed.toISOString();
      }
    }
    return '';
  };

  const parseDatePart = (value: ExcelCell) => {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number' && value > 0 && value < 1) {
      return '';
    }
    if (typeof value === 'string' && timeOnlyPattern.test(value)) {
      return '';
    }
    return parseDateTime(value, true);
  };

  const parseTimePart = (value: ExcelCell) => {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString().split('T')[1]?.replace('Z', '') || '';
    }
    if (typeof value === 'number') {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return `${pad2(parsed.H || 0)}:${pad2(parsed.M || 0)}:${pad2(parsed.S || 0)}`;
      }
      return '';
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return '';
      }
      if (timeOnlyPattern.test(trimmed)) {
        return trimmed.split(':').length === 2 ? `${trimmed}:00` : trimmed;
      }
      const parsed = parseDateTime(trimmed);
      if (parsed) {
        return parsed.split('T')[1]?.replace('Z', '') || '';
      }
    }
    return '';
  };

  const resolveDateTime = (dateCell: ExcelCell, timeCell: ExcelCell) => {
    if (timeCell === null || timeCell === undefined || timeCell === '') {
      return '';
    }
    if (!isTimeOnlyValue(timeCell)) {
      const full = parseDateTime(timeCell);
      if (full) {
        return full;
      }
    }
    const datePart = parseDatePart(dateCell);
    const timePart = parseTimePart(timeCell);
    if (datePart && timePart) {
      const combined = new Date(`${datePart}T${timePart}`);
      if (!isNaN(combined.getTime())) {
        return combined.toISOString();
      }
    }
    return parseDateTime(timeCell);
  };

  const renderRecordDateValue = (row: ParsedExcelRow) => {
    const datePart = parseDatePart(row.日期 ?? row.進場時間);
    if (!datePart) {
      return '-';
    }
    const date = new Date(`${datePart}T00:00:00`);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('zh-TW');
    }
    return datePart;
  };

  const renderRecordTimeValue = (value: ExcelCell) => {
    const timePart = parseTimePart(value);
    if (!timePart) {
      return '-';
    }
    return timePart;
  };

  const normalizeText = (value: ExcelCell) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  };

  const resolveRecordDate = (row: ParsedExcelRow) => {
    const candidate = row.日期 ?? row.進場時間;
    const parsed = parseDatePart(candidate);
    if (!parsed) {
      throw new Error('日期欄位缺失，且進場時間無法解析日期');
    }
    return parsed;
  };

  // 執行匯入
  const handleImport = async () => {
    if (!projectCode || !taskCode) {
      toast.error('請輸入專案代碼和任務代碼');
      return;
    }

    const missingMappings = getMissingRequiredKeys(headerMap);
    if (missingMappings.length > 0) {
      toast.error(`請先完成欄位對應: ${missingMappings.join('、')}`);
      return;
    }

    // 檢查是否有未匹配的員工
    const unmatched = previewData.filter((row) => !row.matchedStaffId);
    if (unmatched.length > 0) {
      toast.error(`尚有 ${unmatched.length} 筆資料未匹配員工，請先完成匹配`);
      return;
    }

    setIsImporting(true);

    try {
      // 取得 task_id
      const taskResult = await getTaskIdByCodes(projectCode, taskCode);
      if (!taskResult.success || !taskResult.data) {
        toast.error(taskResult.error || '找不到對應的任務');
        setIsImporting(false);
        return;
      }

      const taskId = taskResult.data;

      // 準備匯入資料
      const importRecords: ImportTimeRecord[] = previewData.map((row) => {
        const recordDate = resolveRecordDate(row);
        const checkInTime = resolveDateTime(row.日期 ?? row.進場時間, row.進場時間);
        if (!checkInTime) {
          throw new Error('進場時間無法解析');
        }
        const checkOutTime = row.出場時間
          ? resolveDateTime(row.日期 ?? row.進場時間, row.出場時間)
          : null;
        if (row.出場時間 && !checkOutTime) {
          throw new Error('出場時間無法解析');
        }

        const displayName = normalizeText(row.姓名);
        return {
          staff_id: row.matchedStaffId!,
          task_id: taskId,
          record_date: recordDate,
          factory_location: normalizeText(row.廠區),
          check_in_time: checkInTime,
          check_out_time: checkOutTime,
          notes: `匯入自 Excel - ${displayName}`,
        };
      });

      // 執行匯入
      const result = await importTimeRecords(importRecords);

      if (!result.success) {
        toast.error(result.error || '匯入失敗');
        setIsImporting(false);
        return;
      }

      const { imported, skipped, errors } = result.data!;

      if (errors.length > 0) {
        console.error('匯入錯誤:', errors);
      }

      toast.success(
        `匯入完成！成功: ${imported} 筆，跳過: ${skipped} 筆${errors.length > 0 ? `，錯誤: ${errors.length} 筆` : ''}`
      );

      // 導向 billing 看板
      router.push('/dashboard/billing');
    } catch (error) {
      console.error('匯入失敗:', error);
      toast.error('匯入失敗');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Excel 時數紀錄匯入</h1>
        <p className="text-muted-foreground mt-1">
          上傳業主格式的進出廠紀錄 Excel 檔案
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>上傳 Excel 檔案</CardTitle>
          <CardDescription>
            請上傳包含以下欄位的 Excel 檔案：姓名、日期、廠區、進場時間、出場時間
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={isLoading}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">專案代碼 (PY)</label>
              <Input
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                placeholder="例如: PY001"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">任務代碼 (SR)</label>
              <Input
                value={taskCode}
                onChange={(e) => setTaskCode(e.target.value)}
                placeholder="例如: SR001"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {previewData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>預覽資料</CardTitle>
            <CardDescription>
              請確認人員匹配是否正確，如有未匹配的資料請手動選擇
            </CardDescription>
          </CardHeader>
          <CardContent>
            {availableHeaders.length > 0 && (
              <div className="mb-4 rounded-md border bg-muted/30 p-4">
                <div className="mb-2 text-sm font-medium">欄位對應</div>
                <div className="grid gap-4 md:grid-cols-2">
                  {REQUIRED_HEADER_DEFINITIONS.map((definition) => {
                    const isOptional =
                      definition.key === '日期' || definition.key === '出場時間';
                    const isMissing = !headerMap[definition.key];
                    return (
                      <div key={definition.key}>
                        <label className="mb-1 block text-sm font-medium">
                          {definition.key}
                          <span
                            className={`ml-2 text-xs ${
                              isOptional
                                ? 'text-muted-foreground'
                                : isMissing
                                ? 'text-red-600'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {isOptional ? '可選' : isMissing ? '必填' : '已選'}
                          </span>
                        </label>
                        <Select
                          value={headerMap[definition.key] ?? ''}
                          onChange={(event) =>
                            handleHeaderMappingChange(definition.key, event.target.value)
                          }
                        >
                          <option value="">(未選擇)</option>
                          {availableHeaders.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </Select>
                        {definition.key === '日期' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            未提供日期時，會從進場時間自動推導
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead>廠區</TableHead>
                    <TableHead>進場時間</TableHead>
                    <TableHead>出場時間</TableHead>
                    <TableHead>匹配狀態</TableHead>
                    <TableHead>手動選擇</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell>{normalizeText(row.姓名) || '-'}</TableCell>
                      <TableCell>
                        {renderRecordDateValue(row)}
                      </TableCell>
                      <TableCell>{normalizeText(row.廠區) || '-'}</TableCell>
                      <TableCell>
                        {renderRecordTimeValue(row.進場時間)}
                      </TableCell>
                      <TableCell>
                        {renderRecordTimeValue(row.出場時間)}
                      </TableCell>
                      <TableCell>
                        {row.matchStatus === 'matched' && (
                          <span className="text-green-600">✓ 已匹配: {row.matchedStaffName}</span>
                        )}
                        {row.matchStatus === 'manual' && (
                          <span className="text-blue-600">✓ 手動選擇: {row.matchedStaffName}</span>
                        )}
                        {row.matchStatus === 'unmatched' && (
                          <span className="text-red-600">✗ 未匹配</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.matchedStaffId || ''}
                          onChange={(e) => handleStaffSelect(index, e.target.value)}
                        >
                          <option value="">請選擇...</option>
                          {staffProfiles.map((staff) => (
                            <option key={staff.id} value={staff.id}>
                              {staff.name}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? '匯入中...' : '確認匯入'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
