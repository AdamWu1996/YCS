'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { getAllStaffProfiles } from '@/actions/upload/queries';
import { importTimeRecords, ImportTimeRecord } from '@/actions/upload/import';
import {
  createStaffProfile,
  ensureStaffProfileFromAuthUser,
} from '@/actions/staff/createStaffProfile';
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
 * Excel 解析後的原始資料型別（僅人員、日期、廠區、進出場時間；不含 PY/SR）
 */
interface ParsedExcelRow {
  姓名: ExcelCell;
  日期: ExcelCell;
  廠區: ExcelCell;
  進場時間: ExcelCell;
  出場時間: ExcelCell;
}

/**
 * 預覽表格的資料型別（含匹配狀態；匯入後 task_id 一律為 NULL，於裁決階段認領）
 */
interface PreviewRow extends ParsedExcelRow {
  matchedStaffId: string | null;
  matchedStaffName: string | null;
  matchStatus: 'matched' | 'unmatched' | 'manual';
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
    };
  });

/** 未匹配列內嵌的「建立人員」Popover（新建帳號 or 連結既有 auth 帳號，不導頁） */
function CreateStaffPopoverInRow({
  rowIndex,
  excelName,
  open,
  onOpenChange,
  onSuccess,
}: {
  rowIndex: number;
  excelName: ExcelCell;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (excelName: ExcelCell, staffId: string, staffName: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 'create' = 新建 auth + staff；'link' = 僅連結既有 auth 建立 staff */
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const displayName =
    typeof excelName === 'string' ? excelName.trim() : String(excelName ?? '');

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('請輸入 Email');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createStaffProfile({
        name: displayName || trimmedEmail,
        email: trimmedEmail,
        employeeNo: employeeNo.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error ?? '建立人員失敗');
        return;
      }
      if (result.data) {
        onSuccess(excelName, result.data.id, result.data.name);
        toast.success(`已建立人員：${result.data.name}`);
        setEmail('');
        setEmployeeNo('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('請輸入 Email');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await ensureStaffProfileFromAuthUser({
        name: displayName || trimmedEmail,
        email: trimmedEmail,
        employeeNo: employeeNo.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error ?? '連結失敗');
        return;
      }
      if (result.data) {
        onSuccess(excelName, result.data.id, result.data.name);
        toast.success(`已連結人員：${result.data.name}`);
        setEmail('');
        setEmployeeNo('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLink = mode === 'link';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          建立人員
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start" side="right">
        <PopoverHeader>
          <PopoverTitle>建立人員：{displayName || '(未填姓名)'}</PopoverTitle>
        </PopoverHeader>
        <form
          onSubmit={isLink ? handleSubmitLink : handleSubmitCreate}
          className="mt-3 space-y-3"
        >
          <div>
            <Label htmlFor={`create-email-${rowIndex}`}>Email（必填）</Label>
            <Input
              id={`create-email-${rowIndex}`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`create-employee-no-${rowIndex}`}>工號（選填）</Label>
            <Input
              id={`create-employee-no-${rowIndex}`}
              type="text"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="選填"
              className="mt-1"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setMode(isLink ? 'create' : 'link')}
            >
              {isLink ? '改為新建帳號' : '已有帳號？連結既有帳號'}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting
                  ? '處理中...'
                  : isLink
                    ? '連結'
                    : '確認'}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

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
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  /** 匯入 session：同一匯入流程內，姓名 → 已匹配的 staff（建立或手動選擇後同步同名稱所有行，不寫入 DB） */
  const [importSessionState, setImportSessionState] = useState<
    Record<string, { staffId: string; staffName: string }>
  >({});
  /** 僅顯示未匹配人員（表格過濾） */
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  /** 摘要區「建立人員」Popover 目前開啟的姓名 key */
  const [summaryCreatePopoverKey, setSummaryCreatePopoverKey] = useState<string | null>(null);

  /** 載入員工資料；失敗時回傳 { success: false } 以便上傳流程不繼續、不顯示預覽 */
  const loadStaffProfiles = async (): Promise<
    { success: true; data: Array<{ id: string; name: string }> } | { success: false }
  > => {
    const result = await getAllStaffProfiles();
    if (result.success && result.data) {
      setStaffProfiles(result.data);
      return { success: true, data: result.data };
    }
    toast.error('載入員工資料失敗');
    return { success: false };
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
      // 載入員工資料；失敗則不繼續，避免先顯示失敗又載入內容
      const staffResult = await loadStaffProfiles();
      if (!staffResult.success) {
        setIsLoading(false);
        return;
      }
      const staffList = staffResult.data;

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
      setImportSessionState({});
      setCreateStaffPopoverIndex(null);

      const previewRows = buildPreviewRows(jsonData, resolvedMap, staffList, matchStaffName);
      setPreviewData(previewRows);

      const missingRequired = getMissingRequiredKeys(resolvedMap);
      if (missingRequired.length > 0) {
        toast.warning(`請於下方欄位對應完成：${missingRequired.join('、')}`);
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
    const withSession = previewRows.map((r) => {
      const key = nameKey(r.姓名);
      const session = key ? importSessionState[key] : undefined;
      if (session && !r.matchedStaffId) {
        return {
          ...r,
          matchedStaffId: session.staffId,
          matchedStaffName: session.staffName,
          matchStatus: 'manual' as const,
        };
      }
      return r;
    });
    setPreviewData(withSession);
  };

  /** 用於匯入 session 的姓名 key（同名稱同步） */
  const nameKey = (excelName: ExcelCell) =>
    typeof excelName === 'string' ? excelName.trim().toLowerCase() : '';

  /** 未匹配人員的唯一姓名列表（用於摘要看板） */
  const unmatchedUniqueNames = useMemo(() => {
    const seen = new Set<string>();
    const list: ExcelCell[] = [];
    for (const row of previewData) {
      if (row.matchStatus !== 'unmatched') continue;
      const key = nameKey(row.姓名);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(row.姓名);
    }
    return list;
  }, [previewData]);

  /** 全域同步：依 Excel 姓名將所有同名列一併更新為指定 staff（摘要區或表格選擇後共用） */
  const handleGlobalStaffSync = (excelName: ExcelCell, staffId: string) => {
    const staff = staffProfiles.find((s) => s.id === staffId);
    if (!staff) return;
    const key = nameKey(excelName);
    if (!key) return;
    setImportSessionState((prev) => ({
      ...prev,
      [key]: { staffId: staff.id, staffName: staff.name },
    }));
    setPreviewData((prev) =>
      prev.map((r) =>
        nameKey(r.姓名) === key
          ? {
              ...r,
              matchedStaffId: staff.id,
              matchedStaffName: staff.name,
              matchStatus: 'manual',
            }
          : r
      )
    );
  };

  /** 未匹配行的「建立人員」Popover 是否開啟（由列 index 控制） */
  const [createStaffPopoverIndex, setCreateStaffPopoverIndex] = useState<number | null>(null);

  /** 建立人員成功後：加入 staff 列表、更新 session、同步同名稱行、關閉 Popover */
  const handleCreateStaffSuccess = (
    excelName: ExcelCell,
    staffId: string,
    staffName: string
  ) => {
    const key = nameKey(excelName);
    if (!key) return;
    setStaffProfiles((prev) => {
      if (prev.some((s) => s.id === staffId)) return prev;
      return [...prev, { id: staffId, name: staffName }];
    });
    setImportSessionState((prev) => ({
      ...prev,
      [key]: { staffId, staffName },
    }));
    setPreviewData((prev) =>
      prev.map((r) =>
        nameKey(r.姓名) === key
          ? {
              ...r,
              matchedStaffId: staffId,
              matchedStaffName: staffName,
              matchStatus: 'manual',
            }
          : r
      )
    );
    setCreateStaffPopoverIndex(null);
    setSummaryCreatePopoverKey(null);
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

  // 執行匯入（先匯入、後認領：time_records.task_id 一律為 NULL）
  const handleImport = async () => {
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
      // 準備匯入資料（task_id 一律為 null，於裁決中心認領）
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
                          className="bg-background"
                        >
                          <option value="" className="bg-background">(未選擇)</option>
                          {availableHeaders.map((header) => (
                            <option key={header} value={header} className="bg-background">
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
            {unmatchedUniqueNames.length > 0 && (
              <Card className="mb-4 border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">未匹配人員摘要</CardTitle>
                  <CardDescription>
                    以下姓名尚未對應到系統人員，可在此手動選擇或原地建立後，表格中同姓名列會一併更新
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-3">
                  <ul className="flex flex-wrap gap-3">
                    {unmatchedUniqueNames.map((excelName, i) => {
                      const displayName =
                        typeof excelName === 'string' ? excelName.trim() : String(excelName ?? '');
                      const key = nameKey(excelName);
                      return (
                        <li
                          key={key || i}
                          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                        >
                          <span className="font-medium text-foreground">{displayName || '(未填)'}</span>
                          <Select
                            value=""
                            onChange={(e) => {
                              const id = e.target.value;
                              if (id) handleGlobalStaffSync(excelName, id);
                            }}
                            className="w-40 bg-background"
                          >
                            <option value="" className="bg-background">手動選擇...</option>
                            {staffProfiles.map((staff) => (
                              <option key={staff.id} value={staff.id} className="bg-background">
                                {staff.name}
                              </option>
                            ))}
                          </Select>
                          <CreateStaffPopoverInRow
                            rowIndex={i}
                            excelName={excelName}
                            open={summaryCreatePopoverKey === key}
                            onOpenChange={(open) =>
                              setSummaryCreatePopoverKey(open ? key : null)
                            }
                            onSuccess={handleCreateStaffSuccess}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
            <div className="mb-2 flex items-center gap-2">
              <Checkbox
                id="filter-unmatched"
                checked={showUnmatchedOnly}
                onCheckedChange={(checked) => setShowUnmatchedOnly(checked === true)}
              />
              <Label htmlFor="filter-unmatched" className="cursor-pointer text-sm">
                僅顯示未匹配人員
              </Label>
            </div>
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
                  {(showUnmatchedOnly
                    ? previewData
                        .map((row, index) => ({ row, index }))
                        .filter(({ row }) => row.matchStatus === 'unmatched')
                    : previewData.map((row, index) => ({ row, index }))
                  ).map(({ row, index }) => (
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
                          <div className="flex items-center gap-2">
                            <span className="text-red-600">✗ 未匹配</span>
                            <CreateStaffPopoverInRow
                              rowIndex={index}
                              excelName={row.姓名}
                              open={createStaffPopoverIndex === index}
                              onOpenChange={(open) =>
                                setCreateStaffPopoverIndex(open ? index : null)
                              }
                              onSuccess={handleCreateStaffSuccess}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="bg-background">
                        <Select
                          value={row.matchedStaffId || ''}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id) handleGlobalStaffSync(row.姓名, id);
                          }}
                          className="bg-background"
                        >
                          <option value="" className="bg-background">
                            請選擇...
                          </option>
                          {staffProfiles.map((staff) => (
                            <option
                              key={staff.id}
                              value={staff.id}
                              className="bg-background text-foreground"
                            >
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
