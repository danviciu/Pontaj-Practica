const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLASS_REGEX = /\b\d{1,2}[A-Za-z][A-Za-z0-9-]{0,3}\b/;
const PHONE_REGEX = /^(\+?\d{10,15})$/;
const KNOWN_DELIMITERS = [';', '\t', ',', '|'];
const CNP_REGEX = /^\d{12,13}$/;

const HEADER_KEYS = {
    name: ['nume', 'numecomplet', 'fullname', 'full_name', 'student', 'elev'],
    email: ['email', 'e-mail', 'mail'],
    phoneNumber: ['telefon', 'phone', 'telefonmobil', 'mobil', 'numartelefon', 'phoneNumber'],
    pushToken: ['pushtoken', 'push_token', 'devicetoken', 'device_token', 'token'],
    className: ['clasa', 'class', 'classname', 'classa'],
    specialization: ['specializare', 'specialization', 'profil', 'domeniu'],
};

function cleanValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeHeader(value) {
    return cleanValue(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function normalizeName(value) {
    return cleanValue(value);
}

function normalizeEmail(value) {
    const email = cleanValue(value).toLowerCase();
    if (!email) return '';
    return EMAIL_REGEX.test(email) ? email : '';
}

function normalizeClassName(value) {
    return cleanValue(value).toUpperCase();
}

function normalizePhoneNumber(value) {
    const phone = cleanValue(value).replace(/[\s-]/g, '');
    if (!phone) return '';
    return PHONE_REGEX.test(phone) ? phone : '';
}

function normalizeSpecialization(value) {
    return cleanValue(value);
}

function stripDiacritics(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function romanToArabic(romanRaw) {
    const roman = String(romanRaw || '').toUpperCase();
    const values = { I: 1, V: 5, X: 10, L: 50 };
    let total = 0;
    let previous = 0;

    for (let index = roman.length - 1; index >= 0; index -= 1) {
        const value = values[roman[index]] || 0;
        if (value < previous) {
            total -= value;
        } else {
            total += value;
            previous = value;
        }
    }

    return total > 0 ? total : null;
}

function inferClassName(fileName, text) {
    const combined = `${cleanValue(fileName)} ${cleanValue(text)}`;

    const fromName = combined.match(/\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\s*([A-Z])\b/i);
    if (fromName) {
        const level = romanToArabic(fromName[1]);
        const letter = stripDiacritics(fromName[2]).toUpperCase();
        if (level && letter) return `${level} ${letter}`;
    }

    const fromText = combined.match(/clasei\s+a\s+(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\s*-\s*a\s+([A-ZĂÂÎȘȚ])/iu);
    if (fromText) {
        const level = romanToArabic(fromText[1]);
        const letter = stripDiacritics(fromText[2]).toUpperCase();
        if (level && letter) return `${level} ${letter}`;
    }

    return '';
}

function groupPdfItemsByLine(items) {
    const tolerance = 1.3;
    const lines = [];

    items.forEach((item) => {
        const text = cleanValue(item?.str);
        if (!text) return;

        const y = Number(item?.transform?.[5] || 0);
        const x = Number(item?.transform?.[4] || 0);
        const existingLine = lines.find((line) => Math.abs(line.y - y) <= tolerance);

        if (existingLine) {
            existingLine.items.push({ text, x });
        } else {
            lines.push({ y, items: [{ text, x }] });
        }
    });

    return lines
        .map((line) => ({
            y: line.y,
            items: line.items.sort((left, right) => left.x - right.x),
        }))
        .sort((left, right) => right.y - left.y);
}

function looksLikeStudentLine(items) {
    const tokens = items.map((entry) => entry.text);
    const hasCnp = tokens.some((token) => CNP_REGEX.test(token));
    const hasOrderNumber = tokens.slice(0, 3).some((token) => /^\d{1,2}$/.test(token));
    const hasHeaderWords = tokens.some((token) => /numele|prenumele|matricol|observa/i.test(token));
    return hasCnp && hasOrderNumber && !hasHeaderWords;
}

function parsePdfStudentLine(items, lineIndex, inferredClassName) {
    const tokens = items.map((entry) => entry.text).filter(Boolean);
    const cnpIndex = tokens.findIndex((token) => CNP_REGEX.test(token));
    if (cnpIndex <= 0) {
        return null;
    }

    let nameStartIndex = 0;
    while (nameStartIndex < cnpIndex && /^\d+$/.test(tokens[nameStartIndex])) {
        nameStartIndex += 1;
    }

    if (nameStartIndex >= cnpIndex) {
        return {
            student: null,
            issue: {
                line: lineIndex,
                reason: 'Linie PDF fara nume detectabil.',
                raw: tokens.join(' '),
            },
        };
    }

    const nameTokens = tokens
        .slice(nameStartIndex, cnpIndex)
        .filter((token) => !/^(M|F)$/i.test(token));

    const fullName = cleanValue(
        nameTokens
            .join(' ')
            .replace(/\s*[-–]\s*/g, ' - ')
    );

    if (!/[A-Za-zĂÂÎȘȚăâîșț]/.test(fullName)) {
        return {
            student: null,
            issue: {
                line: lineIndex,
                reason: 'Numele elevului nu a putut fi extras din PDF.',
                raw: tokens.join(' '),
            },
        };
    }

    return {
        student: {
            full_name: fullName,
            email: '',
            phoneNumber: '',
            pushToken: '',
            className: normalizeClassName(inferredClassName),
            specialization: '',
        },
        issue: null,
    };
}

function hasKnownHeader(headers) {
    const normalizedSet = new Set(headers.map((header) => normalizeHeader(header)));
    return Object.values(HEADER_KEYS).some((list) => list.some((key) => normalizedSet.has(normalizeHeader(key))));
}

function detectDelimiter(sampleLine) {
    const line = cleanValue(sampleLine);
    if (!line) return ';';

    let chosen = ';';
    let maxScore = 0;

    KNOWN_DELIMITERS.forEach((delimiter) => {
        const score = line.split(delimiter).length;
        if (score > maxScore) {
            maxScore = score;
            chosen = delimiter;
        }
    });

    return chosen;
}

function splitLine(line, delimiter) {
    return String(line || '')
        .split(delimiter)
        .map((part) => cleanValue(part))
        .filter((part) => part.length > 0);
}

function extractColumnValue(rowObject, aliases) {
    const keys = Object.keys(rowObject || {});
    for (const alias of aliases) {
        const foundKey = keys.find((key) => normalizeHeader(key) === normalizeHeader(alias));
        if (foundKey) {
            const value = cleanValue(rowObject[foundKey]);
            if (value) return value;
        }
    }
    return '';
}

function parseRowObject(rowObject, lineIndex) {
    const name = normalizeName(extractColumnValue(rowObject, HEADER_KEYS.name));
    const email = normalizeEmail(extractColumnValue(rowObject, HEADER_KEYS.email));
    const phoneNumber = normalizePhoneNumber(extractColumnValue(rowObject, HEADER_KEYS.phoneNumber));
    const pushToken = cleanValue(extractColumnValue(rowObject, HEADER_KEYS.pushToken));
    const className = normalizeClassName(extractColumnValue(rowObject, HEADER_KEYS.className));
    const specialization = normalizeSpecialization(extractColumnValue(rowObject, HEADER_KEYS.specialization));

    if (!name) {
        return {
            student: null,
            issue: {
                line: lineIndex,
                reason: 'Lipseste numele elevului.',
                raw: rowObject,
            },
        };
    }

    return {
        student: { full_name: name, email, phoneNumber, pushToken, className, specialization },
        issue: null,
    };
}

function parseLooseLine(line, lineIndex) {
    const cleaned = cleanValue(line).replace(/^\d+[\).:\-]\s*/, '');
    if (!cleaned) {
        return { student: null, issue: null };
    }

    if (hasKnownHeader([cleaned])) {
        return { student: null, issue: null };
    }

    const delimiter = detectDelimiter(cleaned);
    const tokens = splitLine(cleaned, delimiter);
    const parsedTokens = tokens.length > 1 ? tokens : cleaned.split(/\s{2,}/).map(cleanValue).filter(Boolean);

    const emailToken = parsedTokens.find((token) => EMAIL_REGEX.test(token.toLowerCase()));
    const phoneToken = parsedTokens.find((token) => PHONE_REGEX.test(token.replace(/[\s-]/g, '')));
    const pushTokenCandidate = parsedTokens.find((token) => (
        !EMAIL_REGEX.test(token.toLowerCase())
        && !PHONE_REGEX.test(token.replace(/[\s-]/g, ''))
        && token.length > 20
        && /[A-Za-z0-9_-]/.test(token)
    ));
    const classToken = parsedTokens.find((token) => CLASS_REGEX.test(token.toUpperCase()));
    const nameToken = parsedTokens.find((token) =>
        !EMAIL_REGEX.test(token.toLowerCase())
        && !PHONE_REGEX.test(token.replace(/[\s-]/g, ''))
        && token !== pushTokenCandidate
        && !CLASS_REGEX.test(token.toUpperCase())
    );
    const specializationToken = parsedTokens.find((token) => (
        token !== emailToken
        && token !== phoneToken
        && token !== pushTokenCandidate
        && token !== classToken
        && token !== nameToken
    ));

    const name = normalizeName(nameToken || '');
    if (!name) {
        return {
            student: null,
            issue: {
                line: lineIndex,
                reason: 'Nu am putut identifica numele.',
                raw: line,
            },
        };
    }

    return {
        student: {
            full_name: name,
            email: normalizeEmail(emailToken || ''),
            phoneNumber: normalizePhoneNumber(phoneToken || ''),
            pushToken: cleanValue(pushTokenCandidate || ''),
            className: normalizeClassName(classToken || ''),
            specialization: normalizeSpecialization(specializationToken || ''),
        },
        issue: null,
    };
}

function dedupeStudents(students) {
    const result = [];
    const seen = new Set();

    students.forEach((student) => {
        const identity = `${student.email || ''}|${student.full_name.toLowerCase()}|${student.className || ''}`;
        if (!seen.has(identity)) {
            seen.add(identity);
            result.push(student);
        }
    });

    return result;
}

function parseTextBlock(text, sourceLabel = 'text') {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => cleanValue(line))
        .filter(Boolean);

    if (lines.length === 0) {
        return { students: [], skipped: [{ line: 0, reason: 'Fisierul este gol.', raw: sourceLabel }] };
    }

    const firstLineDelimiter = detectDelimiter(lines[0]);
    const firstLineColumns = splitLine(lines[0], firstLineDelimiter);
    const canTreatAsTable = firstLineColumns.length >= 2 && hasKnownHeader(firstLineColumns);

    const parsedStudents = [];
    const skipped = [];

    if (canTreatAsTable) {
        const headers = firstLineColumns;
        for (let index = 1; index < lines.length; index += 1) {
            const values = splitLine(lines[index], firstLineDelimiter);
            if (values.length === 0) continue;

            const rowObject = {};
            headers.forEach((header, headerIndex) => {
                rowObject[header] = values[headerIndex] || '';
            });

            const parsed = parseRowObject(rowObject, index + 1);
            if (parsed.student) {
                parsedStudents.push(parsed.student);
            } else if (parsed.issue) {
                skipped.push(parsed.issue);
            }
        }
    } else {
        lines.forEach((line, index) => {
            const parsed = parseLooseLine(line, index + 1);
            if (parsed.student) {
                parsedStudents.push(parsed.student);
            } else if (parsed.issue) {
                skipped.push(parsed.issue);
            }
        });
    }

    return {
        students: dedupeStudents(parsedStudents),
        skipped,
    };
}

function parseSpreadsheet(arrayBuffer) {
    return import('xlsx').then((xlsxModule) => {
        const XLSX = xlsxModule.default || xlsxModule;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const students = [];
        const skipped = [];

        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            rows.forEach((rowObject, rowIndex) => {
                const parsed = parseRowObject(rowObject, rowIndex + 2);
                if (parsed.student) {
                    students.push(parsed.student);
                } else if (parsed.issue) {
                    skipped.push(parsed.issue);
                }
            });
        });

        return {
            students: dedupeStudents(students),
            skipped,
        };
    });
}

function parseDocx(arrayBuffer) {
    return import('mammoth/mammoth.browser').then(async (mammothModule) => {
        const mammoth = mammothModule.default || mammothModule;
        const result = await mammoth.extractRawText({ arrayBuffer });
        return parseTextBlock(result.value, 'docx');
    });
}

async function parsePdf(arrayBuffer, fileName = '') {
    const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerSrcModule = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');

    if (pdfjsModule.GlobalWorkerOptions) {
        pdfjsModule.GlobalWorkerOptions.workerSrc = workerSrcModule.default;
    }

    const loadingTask = pdfjsModule.getDocument({
        data: arrayBuffer,
    });
    const pdf = await loadingTask.promise;

    const students = [];
    const skipped = [];
    let inferredClassName = '';
    let fullText = '';

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => cleanValue(item.str)).join(' ');
        fullText += `${pageText}\n`;

        if (!inferredClassName) {
            inferredClassName = inferClassName(fileName, pageText);
        }

        const lines = groupPdfItemsByLine(textContent.items);
        lines.forEach((line, lineIndex) => {
            if (!looksLikeStudentLine(line.items)) return;
            const parsed = parsePdfStudentLine(line.items, lineIndex + 1, inferredClassName);
            if (!parsed) return;
            if (parsed.student) {
                students.push(parsed.student);
            } else if (parsed.issue) {
                skipped.push(parsed.issue);
            }
        });
    }

    if (students.length > 0) {
        return {
            students: dedupeStudents(students),
            skipped,
        };
    }

    return parseTextBlock(fullText, 'pdf');
}

export async function parseStudentsFile(file) {
    if (!file) {
        throw new Error('Nu a fost selectat niciun fisier.');
    }

    const extension = String(file.name || '')
        .toLowerCase()
        .split('.')
        .pop();

    const arrayBuffer = await file.arrayBuffer();

    if (['xlsx', 'xls'].includes(extension)) {
        return parseSpreadsheet(arrayBuffer);
    }

    if (extension === 'docx') {
        return parseDocx(arrayBuffer);
    }

    if (extension === 'pdf') {
        return parsePdf(arrayBuffer, file.name || '');
    }

    if (['csv', 'txt', 'doc'].includes(extension)) {
        const text = new TextDecoder('utf-8').decode(arrayBuffer);
        return parseTextBlock(text, extension);
    }

    throw new Error('Format neacceptat. Foloseste .xlsx, .xls, .csv, .txt, .docx sau .pdf.');
}
