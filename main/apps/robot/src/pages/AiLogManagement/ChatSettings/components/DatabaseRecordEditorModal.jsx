import React, { useState } from 'react'
import styled from 'styled-components'

import {
    createChatScreen,
    createChatGuidance,
    createChatPrompt,
    createChatRagDoc,
    deleteChatScreen,
    deleteChatGuidance,
    deleteChatPrompt,
    deleteChatRagDoc,
    deleteChatRule,
    updateChatScreen,
    updateChatGuidance,
    updateChatPrompt,
    updateChatRagDoc,
    upsertChatRule,
} from '@repo/apis/ai/chatSettings'

import {
    ModalActions,
    ModalBackdrop,
    ModalCard,
    ModalTitle,
    PrimaryButton,
    SecondaryTextButton,
} from '../styles'

const APP_OPTIONS = ['common', 'cms', 'ota', 'robot', 'tms', 'learning']

const FORM_CONFIG = {
    screen: {
        label: '화면',
        fields: [
            { key: 'appKey', label: '앱', required: true },
            { key: 'screenKey', label: '화면 Key', required: true, identity: true },
            { key: 'screenName', label: '화면 이름', required: true },
            { key: 'enabled', label: '활성', type: 'checkbox', defaultValue: true },
        ],
    },
    guidance: {
        label: '가이드/힌트',
        fields: [
            { key: 'appKey', label: '앱', identity: true },
            { key: 'screenKey', label: '화면', required: true, identity: true },
            { key: 'examples', label: '가이드/힌트 JSON', type: 'json', rows: 12, defaultValue: [] },
        ],
    },
    prompt: {
        label: '프롬프트',
        fields: [
            { key: 'appKey', label: '앱', identity: true },
            { key: 'screenKey', label: '화면', required: true, identity: true },
            {
                key: 'type',
                label: '유형',
                required: true,
                identity: true,
                type: 'select',
                options: ['instruction', 'intent-classifier', 'rag-info', 'rag-action'],
                defaultValue: 'instruction',
            },
            { key: 'prompt', label: '프롬프트', type: 'messageBundle', rows: 14 },
            { key: 'enabled', label: '활성', type: 'checkbox', defaultValue: true },
        ],
    },
    rag: {
        label: 'RAG 문서',
        fields: [
            { key: 'appKey', label: '앱', identity: true },
            { key: 'chunkKey', label: 'Chunk Key', required: true },
            { key: 'title', label: '제목' },
            { key: 'keywords', label: '키워드 JSON', type: 'json', rows: 5, defaultValue: [] },
            { key: 'body', label: '본문', type: 'textarea', rows: 12 },
            { key: 'imageUrl', label: '이미지 URL' },
            { key: 'intentType', label: '인텐트 유형', type: 'select', options: ['info', 'action'], defaultValue: 'info' },
            { key: 'enabled', label: '활성', type: 'checkbox', defaultValue: true },
        ],
    },
    rule: {
        label: 'Rule',
        fields: [
            { key: 'appKey', label: '앱 (appKey)', required: true, identity: true },
            { key: 'screenKey', label: '화면 (screenKey)', required: true, identity: true },
            { key: 'ruleKey', label: '규칙 키 (ruleKey)', required: true, identity: true },
            { key: 'command', label: '명령 (command)' },
            { key: 'patternRegex', label: '정규식 (patternRegex)' },
            { key: 'description', label: '설명 (description)', type: 'textarea', rows: 4 },
            { key: 'replyText', label: '응답 문구 (replyText)', type: 'textarea', rows: 4 },
            { key: 'fallbackText', label: '실패 문구 (fallbackText)', type: 'textarea', rows: 4 },
            { key: 'example', label: '예시 JSON (example)', type: 'json', rows: 5, defaultValue: [] },
            { key: 'extraJson', label: '추가 메타데이터 JSON (extraJson)', type: 'json', rows: 8, defaultValue: {} },
            { key: 'enabled', label: '활성 (enabled)', type: 'checkbox', defaultValue: true },
        ],
    },
}

const getRecordValue = (record, key) => {
    if (record?.[key] !== undefined) return record[key]
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    return record?.[snakeKey]
}

const createDraft = (fields, record) => Object.fromEntries(fields.map((field) => {
    const sourceValue = getRecordValue(record, field.key)
    const value = sourceValue === undefined ? field.defaultValue ?? '' : sourceValue
    return [field.key, field.type === 'json' ? JSON.stringify(value, null, 2) : value]
}))

/** action-tools 처럼 여러 문구를 JSON 한 덩어리로 담아 둔 프롬프트를 키별로 나눠 편집한다.
 * 저장 값은 그대로 JSON 문자열이라 서버/DB 구조는 바뀌지 않는다.
 */
const parseMessageBundle = (value) => {
    const text = String(value ?? '').trim()
    if (!text.startsWith('{')) return null
    try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        if (Object.values(parsed).some((row) => typeof row === 'object' && row !== null)) return null
        return parsed
    } catch {
        return null
    }
}

const MessageBundleEditor = ({ value, onChange }) => {
    const bundle = parseMessageBundle(value)
    const [rawMode, setRawMode] = React.useState(false)
    const [filter, setFilter] = React.useState('')
    const [newKey, setNewKey] = React.useState('')

    if (!bundle) {
        return (
            <FormTextarea rows={18} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
        )
    }

    const write = (next) => onChange(JSON.stringify(next, null, 2))
    const keys = Object.keys(bundle)
    const needle = filter.trim().toLowerCase()
    // 접두어(llm./ui./cfg. + 두번째 마디)끼리 묶어 보여 줘야 찾기 쉽다.
    const visibleKeys = keys
        .filter((key) => !needle || key.toLowerCase().includes(needle) || String(bundle[key]).toLowerCase().includes(needle))
        .sort((a, b) => a.localeCompare(b))
    // 키의 마지막 마디만 항목 이름으로 쓰고, 앞 마디는 그룹 머리말(llm › tool › edit › param)로 올린다.
    const groups = visibleKeys.reduce((acc, key) => {
        const parts = key.split('.')
        const group = parts.slice(0, -1).join('.')
        const last = acc[acc.length - 1]
        if (last && last.group === group) last.keys.push(key)
        else acc.push({ group, depth: Math.max(0, parts.length - 2), keys: [key] })
        return acc
    }, [])

    return (
        <BundleWrap>
            <BundleToolbar>
                <FormInput
                    placeholder="키 또는 내용 검색"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                />
                <BundleCount>{visibleKeys.length}/{keys.length} 항목</BundleCount>
                <BundleGhostButton type="button" onClick={() => setRawMode((prev) => !prev)}>
                    {rawMode ? '항목별 보기' : '원문 JSON 보기'}
                </BundleGhostButton>
            </BundleToolbar>

            {rawMode ? (
                <FormTextarea rows={24} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
            ) : (
                <>
                    {groups.map(({ group, depth, keys: groupKeys }) => (
                        <React.Fragment key={group}>
                            <BundleGroupHead $depth={depth}>
                                <BundleKey>{group ? group.split('.').join(' › ') : '(최상위)'}</BundleKey>
                                <BundleMeta>{groupKeys.length}개</BundleMeta>
                            </BundleGroupHead>
                            {groupKeys.map((key) => {
                                const text = String(bundle[key] ?? '')
                                const rows = Math.min(20, Math.max(2, text.split('\n').length + 1))
                                return (
                                <BundleRow key={key} $depth={depth}>
                                    <BundleRowHead>
                                        <BundleKey title={key}>{key.split('.').pop()}</BundleKey>
                                        <BundleMeta>{text.length}자</BundleMeta>
                                        <BundleGhostButton
                                            type="button"
                                            onClick={() => {
                                                const next = { ...bundle }
                                                delete next[key]
                                                write(next)
                                            }}
                                        >
                                            삭제
                                        </BundleGhostButton>
                                    </BundleRowHead>
                                    <FormTextarea
                                        rows={rows}
                                        value={text}
                                        onChange={(event) => write({ ...bundle, [key]: event.target.value })}
                                    />
                                </BundleRow>
                                )
                            })}
                        </React.Fragment>
                    ))}

                    <BundleToolbar>
                        <FormInput
                            placeholder="새 키 (예: ui.edit.locationRequired)"
                            value={newKey}
                            onChange={(event) => setNewKey(event.target.value)}
                        />
                        <BundleGhostButton
                            type="button"
                            onClick={() => {
                                const key = newKey.trim()
                                if (!key || bundle[key] !== undefined) return
                                write({ ...bundle, [key]: '' })
                                setNewKey('')
                            }}
                        >
                            항목 추가
                        </BundleGhostButton>
                    </BundleToolbar>
                </>
            )}
        </BundleWrap>
    )
}

const BodyLengthMeter = ({ value, maxChars = 700 }) => {
    const text = typeof value === 'string' ? value : ''
    const length = text.length
    const limit = Number(maxChars ?? 700)
    const isOverLimit = length > limit

    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>본문 길이</span>
            <strong style={{ fontSize: '12px', color: isOverLimit ? '#dc2626' : '#334155' }}>
                현재 {length} / 제한 {limit}자
            </strong>
        </div>
    )
}

const parseJsonField = (value, label) => {
    try {
        return JSON.parse(String(value || 'null'))
    } catch {
        throw new Error(`${label} 형식이 올바른 JSON이 아닙니다.`)
    }
}

const assertSuccessful = (response) => {
    if (Number(response?.code) !== 200) {
        throw new Error(String(response?.message || '요청 처리에 실패했습니다.'))
    }
    return response?.data
}

export const DatabaseRecordEditorModal = ({
    kind,
    item,
    screens,
    promptTypes,
    onClose,
    onChanged,
    maxCharsPerChunk = 700,
    maxChunksPerApp = 3,
    appRagCountMap = {},
}) => {
    const config = FORM_CONFIG[kind] ?? FORM_CONFIG.guidance
    const editing = Boolean(item?.id)
    const screenOptions = (Array.isArray(screens) ? screens : [])
        .map((screen) => ({
            appKey: String(getRecordValue(screen, 'appKey') ?? ''),
            screenKey: String(getRecordValue(screen, 'screenKey') ?? ''),
            screenName: String(getRecordValue(screen, 'screenName') ?? ''),
        }))
        .filter((screen) => screen.screenKey)
        .sort((left, right) => left.screenKey.localeCompare(right.screenKey))
    const [draft, setDraft] = useState(() => createDraft(config.fields, item))
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [error, setError] = useState('')
    const [regexTestText, setRegexTestText] = useState('')
    const [regexTestResult, setRegexTestResult] = useState(null)
    const selectedAppKey = String(draft.appKey ?? '')
    const filteredScreenOptions = screenOptions.filter((screen) => screen.appKey === selectedAppKey)

    const setField = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }))
    }

    const selectApp = (appKey) => {
        setDraft((current) => ({
            ...current,
            appKey,
            screenKey: kind === 'screen' ? current.screenKey : (kind === 'prompt' && appKey === 'common' ? 'common' : ''),
        }))
    }

    const selectScreen = (screenKey) => {
        setDraft((current) => ({ ...current, screenKey }))
    }

    const testRegexPattern = (patternText, sampleText) => {
        const trimmedPattern = String(patternText ?? '').trim()
        if (!trimmedPattern) {
            return { ok: false, matches: false, message: '정규식을 먼저 입력해 주세요.' }
        }

        try {
            let regex
            const slashIndex = trimmedPattern.lastIndexOf('/')
            if (trimmedPattern.startsWith('/') && slashIndex > 0) {
                const pattern = trimmedPattern.slice(1, slashIndex)
                const flags = trimmedPattern.slice(slashIndex + 1)
                regex = new RegExp(pattern, flags)
            } else {
                regex = new RegExp(trimmedPattern)
            }

            const testValue = String(sampleText ?? '')
            const matches = regex.test(testValue)
            return {
                ok: true,
                matches,
                message: matches ? '매칭됨' : '매칭되지 않음',
            }
        } catch (requestError) {
            return {
                ok: false,
                matches: false,
                message: requestError?.message || '정규식이 올바르지 않습니다.',
            }
        }
    }

    const buildPayload = () => {
        const payload = {}
        for (const field of config.fields) {
            const value = draft[field.key]
            if (field.required && !String(value ?? '').trim()) {
                throw new Error(`${field.label} 값을 입력해 주세요.`)
            }
            if (field.type === 'json') payload[field.key] = parseJsonField(value, field.label)
            else if (field.type === 'number') payload[field.key] = Number(value)
            else if (field.type === 'checkbox') payload[field.key] = Boolean(value)
            else payload[field.key] = String(value ?? '')
        }

        if (kind === 'rag') {
            const bodyLimit = Number(maxCharsPerChunk ?? 700)
            if (String(payload.body ?? '').length > bodyLimit) {
                throw new Error(`RAG 본문은 ${bodyLimit}자를 넘길 수 없습니다.`)
            }

            if (!editing) {
                const targetAppKey = String(payload.appKey ?? '').trim()
                const targetIntentType = String(payload.intentType ?? 'info').trim().toLowerCase()
                const appCounts = targetAppKey ? appRagCountMap[targetAppKey] ?? { info: 0, action: 0 } : { info: 0, action: 0 }
                const limit = Math.max(1, Number(maxChunksPerApp ?? 3))

                const exceedsInfo = (targetIntentType === 'info' || targetIntentType === 'both') && appCounts.info >= limit
                const exceedsAction = (targetIntentType === 'action' || targetIntentType === 'both') && appCounts.action >= limit
                if (targetAppKey && (exceedsInfo || exceedsAction)) {
                    const intentLabel = targetIntentType === 'action' ? '액션 인텐트' : targetIntentType === 'both' ? '정보/액션 인텐트' : '정보 인텐트'
                    throw new Error(`앱당 ${intentLabel} RAG 청크는 최대 ${limit}개까지 등록할 수 있습니다.`)
                }
            }
        }

        return payload
    }

    const save = async () => {
        setSaving(true)
        setError('')
        try {
            const payload = buildPayload()
            if (kind === 'screen') {
                if (editing) {
                    assertSuccessful(await updateChatScreen(item.id, {
                        appKey: payload.appKey,
                        screenName: payload.screenName,
                        enabled: payload.enabled,
                    }))
                } else {
                    assertSuccessful(await createChatScreen(payload))
                }
            } else if (kind === 'guidance') {
                if (editing) {
                    assertSuccessful(await updateChatGuidance(item.id, { examples: payload.examples }))
                } else {
                    const created = assertSuccessful(await createChatGuidance({ appKey: payload.appKey, screenKey: payload.screenKey }))
                    assertSuccessful(await updateChatGuidance(created.id, { examples: payload.examples }))
                }
            } else if (kind === 'prompt') {
                if (editing) assertSuccessful(await updateChatPrompt(item.id, { prompt: payload.prompt, enabled: payload.enabled }))
                else assertSuccessful(await createChatPrompt(payload))
            } else if (kind === 'rag') {
                const writable = {
                    chunkKey: payload.chunkKey,
                    title: payload.title,
                    keywords: payload.keywords,
                    body: payload.body,
                    imageUrl: payload.imageUrl,
                    intentType: payload.intentType,
                    enabled: payload.enabled,
                }
                if (editing) assertSuccessful(await updateChatRagDoc(item.id, writable))
                else assertSuccessful(await createChatRagDoc({ ...payload, screenKey: payload.appKey }))
            } else if (kind === 'rule') {
                assertSuccessful(await upsertChatRule(payload))
            }
            await onChanged()
            onClose()
        } catch (requestError) {
            setError(requestError?.message || '저장하지 못했습니다.')
        } finally {
            setSaving(false)
        }
    }

    const remove = async () => {
        setDeleting(true)
        setError('')
        try {
            if (kind === 'screen') assertSuccessful(await deleteChatScreen(item.id))
            else if (kind === 'guidance') assertSuccessful(await deleteChatGuidance(item.id))
            else if (kind === 'prompt') assertSuccessful(await deleteChatPrompt(item.id))
            else if (kind === 'rag') assertSuccessful(await deleteChatRagDoc(item.id))
            else if (kind === 'rule') assertSuccessful(await deleteChatRule(item.id))
            await onChanged()
            onClose()
        } catch (requestError) {
            setError(requestError?.message || '삭제하지 못했습니다.')
        } finally {
            setDeleting(false)
        }
    }

    return (
        <ModalBackdrop>
            <ModalCard style={{ width: 'min(860px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}>
                <ModalTitle>{config.label} {editing ? '수정' : '추가'}</ModalTitle>
                <FormGrid>
                    {config.fields.map((field) => {
                        const isPatternRegexField = kind === 'rule' && field.key === 'patternRegex'

                        return (
                            <React.Fragment key={field.key}>
                                <FormField $wide={isPatternRegexField || field.type === 'textarea' || field.type === 'json' || field.type === 'messageBundle'}>
                                    <FormLabel htmlFor={`${kind}-${field.key}`}>
                                        {field.label}{field.required ? ' *' : ''}
                                    </FormLabel>
                                    {!editing && field.key === 'appKey' ? (
                                        <FormSelect
                                            id={`${kind}-${field.key}`}
                                            value={selectedAppKey}
                                            onChange={(event) => selectApp(event.target.value)}
                                        >
                                            <option value="">앱을 선택하세요</option>
                                            {APP_OPTIONS.map((appKey) => <option key={appKey} value={appKey}>{appKey}</option>)}
                                        </FormSelect>
                                    ) : !editing && kind !== 'screen' && field.key === 'screenKey' ? (
                                        <FormSelect
                                            id={`${kind}-${field.key}`}
                                            value={String(draft.screenKey ?? '')}
                                            disabled={!selectedAppKey || selectedAppKey === 'common'}
                                            onChange={(event) => selectScreen(event.target.value)}
                                        >
                                            <option value="">{selectedAppKey ? '화면을 선택하세요' : '앱을 먼저 선택하세요'}</option>
                                            {filteredScreenOptions.map((screen) => (
                                                <option key={screen.screenKey} value={screen.screenKey}>
                                                    {screen.screenName ? `${screen.screenKey} - ${screen.screenName}` : screen.screenKey}
                                                </option>
                                            ))}
                                        </FormSelect>
                                    ) : field.type === 'checkbox' ? (
                                        <CheckboxLabel>
                                            <input
                                                id={`${kind}-${field.key}`}
                                                type="checkbox"
                                                checked={Boolean(draft[field.key])}
                                                onChange={(event) => setField(field.key, event.target.checked)}
                                            />
                                            사용
                                        </CheckboxLabel>
                                    ) : field.type === 'select' ? (
                                        <FormSelect
                                            id={`${kind}-${field.key}`}
                                            value={String(draft[field.key] ?? '')}
                                            onChange={(event) => setField(field.key, event.target.value)}
                                        >
                                            {editing && field.key === 'intentType' && draft[field.key] === 'both' ? (
                                                <option value="both">both (기존 데이터)</option>
                                            ) : null}
                                            {(kind === 'prompt' && field.key === 'type'
                                                ? (Array.isArray(promptTypes) && promptTypes.length > 0 ? promptTypes : field.options)
                                                : field.options
                                            ).map((option) => {
                                                const value = typeof option === 'string' ? option : option.key
                                                const label = typeof option === 'string' ? option : option.label
                                                return <option key={value} value={value}>{label}</option>
                                            })}
                                        </FormSelect>
                                    ) : field.type === 'messageBundle' ? (
                                        <MessageBundleEditor
                                            value={draft[field.key]}
                                            onChange={(next) => setField(field.key, next)}
                                        />
                                    ) : field.type === 'textarea' || field.type === 'json' ? (
                                        <>
                                            <FormTextarea
                                                id={`${kind}-${field.key}`}
                                                rows={field.rows}
                                                value={String(draft[field.key] ?? '')}
                                                onChange={(event) => setField(field.key, event.target.value)}
                                            />
                                            {kind === 'rag' && field.key === 'body' ? (
                                                <BodyLengthMeter value={draft.body} maxChars={maxCharsPerChunk} />
                                            ) : null}
                                        </>
                                    ) : (
                                        <FormInput
                                            id={`${kind}-${field.key}`}
                                            type={field.type === 'number' ? 'number' : 'text'}
                                            value={String(draft[field.key] ?? '')}
                                            placeholder={field.placeholder}
                                            disabled={(editing && field.identity) || (!editing && kind !== 'screen' && field.key === 'appKey')}
                                            onChange={(event) => setField(field.key, event.target.value)}
                                        />
                                    )}
                                </FormField>

                                {isPatternRegexField && kind === 'rule' ? (
                                    <RegexTestSection>
                                        <RegexTestHeader>
                                            <FormLabel>실제 문장 테스트</FormLabel>
                                        </RegexTestHeader>
                                        <RegexTestControls>
                                            <RegexTestInput
                                                value={regexTestText}
                                                onChange={(event) => setRegexTestText(event.target.value)}
                                                placeholder="예: 사용자 메시지 입력"
                                            />
                                            <PrimaryButton
                                                type="button"
                                                onClick={() => setRegexTestResult(testRegexPattern(draft.patternRegex, regexTestText))}
                                            >
                                                테스트
                                            </PrimaryButton>
                                        </RegexTestControls>
                                        <RegexTestResult $matched={Boolean(regexTestResult?.matches && regexTestResult?.ok)}>
                                            {regexTestResult ? regexTestResult.message : '정규식과 입력 문장을 넣고 테스트 버튼을 눌러보세요.'}
                                        </RegexTestResult>
                                    </RegexTestSection>
                                ) : null}
                            </React.Fragment>
                        )
                    })}
                </FormGrid>

                {error ? <ErrorMessage>{error}</ErrorMessage> : null}
                {confirmingDelete ? <DeleteWarning>삭제하면 복구할 수 없습니다. 정말 삭제하시겠습니까?</DeleteWarning> : null}

                <ModalActions>
                    {editing ? (
                        confirmingDelete ? (
                            <DangerButton type="button" onClick={remove} disabled={deleting}>{deleting ? '삭제 중...' : '삭제 확인'}</DangerButton>
                        ) : (
                            <DangerButton type="button" onClick={() => setConfirmingDelete(true)}>삭제</DangerButton>
                        )
                    ) : null}
                    <ActionSpacer />
                    <SecondaryTextButton type="button" onClick={onClose}>취소</SecondaryTextButton>
                    <PrimaryButton type="button" onClick={save} disabled={saving || deleting}>{saving ? '저장 중...' : '저장'}</PrimaryButton>
                </ModalActions>
            </ModalCard>
        </ModalBackdrop>
    )
}

const FormGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 18px;

    @media (max-width: 720px) {
        grid-template-columns: 1fr;
    }
`
const FormField = styled.div`
    display: grid;
    grid-column: ${({ $wide }) => ($wide ? '1 / -1' : 'auto')};
    gap: 6px;
    min-width: 0;
`
const FormLabel = styled.label`
    color: #475569;
    font-size: 12px;
    font-weight: 800;
`
const inputStyle = `
    width: 100%;
    border: 1px solid #dbe3ef;
    border-radius: 7px;
    background: #fff;
    color: #1f2937;
    font-family: inherit;
    font-size: 13px;
    &:focus { border-color: #2563eb; outline: 2px solid #dbeafe; }
    &:disabled { background: #f1f5f9; color: #64748b; }
`
const FormInput = styled.input`
    ${inputStyle}
    height: 38px;
    padding: 0 10px;
`
const FormSelect = styled.select`
    ${inputStyle}
    height: 38px;
    padding: 0 10px;
`
const FormTextarea = styled.textarea`
    ${inputStyle}
    min-height: 100px;
    padding: 10px;
    line-height: 1.55;
    resize: vertical;
`
const BundleWrap = styled.div`
    display: grid;
    gap: 10px;
`
const BundleToolbar = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`
const BundleCount = styled.span`
    color: #64748b;
    font-size: 12px;
    white-space: nowrap;
`
const BundleRow = styled.div`
    display: grid;
    gap: 6px;
    margin-left: ${({ $depth = 0 }) => $depth * 14 + 12}px;
    padding: 10px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
`
const BundleGroupHead = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    margin-left: ${({ $depth = 0 }) => $depth * 14}px;
    padding-bottom: 4px;
    border-bottom: 1px solid #cbd5e1;
`
const BundleRowHead = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`
const BundleKey = styled.code`
    flex: 1;
    color: #1e293b;
    font-size: 12px;
    font-weight: 600;
`
const BundleMeta = styled.span`
    color: #94a3b8;
    font-size: 11px;
    white-space: nowrap;
`
const BundleGhostButton = styled.button`
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 6px 10px;
    background: #fff;
    color: #334155;
    font-size: 12px;
    cursor: pointer;

    &:hover {
        background: #f1f5f9;
    }
`
const CheckboxLabel = styled.label`
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    color: #334155;
    font-size: 13px;
`
const RegexTestSection = styled.div`
    display: grid;
    grid-column: 1 / -1;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid #dbe3ef;
    border-radius: 10px;
    background: #f8fafc;
`
const RegexTestHeader = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
`
const RegexTestControls = styled.div`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
`
const RegexTestInput = styled.input`
    ${inputStyle}
    height: 38px;
    padding: 0 10px;
    min-width: 0;
`
const RegexTestResult = styled.div`
    min-height: 20px;
    color: ${({ $matched }) => ($matched ? '#15803d' : '#475569')};
    font-size: 12px;
    font-weight: 700;
`
const ErrorMessage = styled.div`
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid #fecaca;
    border-radius: 7px;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 12px;
`
const DeleteWarning = styled.div`
    margin-top: 14px;
    color: #b91c1c;
    font-size: 12px;
    font-weight: 700;
`
const DangerButton = styled.button`
    height: 36px;
    padding: 0 13px;
    border: 1px solid #dc2626;
    border-radius: 7px;
    background: #fff;
    color: #dc2626;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    &:disabled { cursor: default; opacity: 0.5; }
`
const ActionSpacer = styled.span`
    flex: 1;
`
