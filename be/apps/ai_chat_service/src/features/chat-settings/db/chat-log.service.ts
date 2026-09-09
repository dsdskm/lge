import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { ChatLogEntity } from './chat-log.entity'
import type { ChatTurn } from '../../../pipeline/pipeline.types'

export type ChatLogInput = {
  author?: string
  conversationId?: string
  currentApp?: string
  currentPath?: string
  chatAction?: string
  userMessage?: string
  assistantText?: string
  debugMeta?: Record<string, unknown>
}

export type ChatLogListQuery = {
  limit?: number
  currentApp?: string
  author?: string
  conversationId?: string
}

export type ChatLogPageQuery = {
  page?: number
  pageSize?: number
  currentApp?: string
  author?: string
  conversationId?: string
}

export type ChatLogPageResult = {
  items: ChatLogEntity[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

@Injectable()
export class ChatLogService {
  private readonly logger = new Logger(ChatLogService.name)

  constructor(
    @InjectRepository(ChatLogEntity)
    private readonly repo: Repository<ChatLogEntity>,
  ) {}

  /**
   * 대화기록 저장. 저장 실패가 채팅 응답을 막지 않도록 예외를 삼킨다.
   *
   * 덤프 복원 뒤 id 시퀀스가 max(id) 보다 작게 남으면 PK 충돌로 INSERT 가 계속 실패한다.
   * 그 경우 "채팅 내역이 안 쌓인다" 로만 보이므로, 한 번은 시퀀스를 맞춰 다시 시도한다.
   */
  async save(input: ChatLogInput): Promise<void> {
    try {
      await this.insert(input)
    } catch (e: any) {
      const message = String(e?.message ?? e)
      const isDuplicateId = e?.code === '23505' || /duplicate key value/i.test(message)

      if (!isDuplicateId) {
        this.logger.error(`[db] insert chat_log FAILED err=${message}`)
        return
      }

      this.logger.warn(`[db] insert chat_log PK 충돌. id 시퀀스를 max(id) 로 맞추고 재시도한다. err=${message}`)
      try {
        await this.resyncIdSequence()
        await this.insert(input)
      } catch (retryError: any) {
        this.logger.error(`[db] insert chat_log FAILED after resync err=${retryError?.message ?? String(retryError)}`)
      }
    }
  }

  private async insert(input: ChatLogInput): Promise<void> {
    const entity = this.repo.create({
      author: input.author,
      conversationId: input.conversationId,
      currentApp: input.currentApp,
      currentPath: input.currentPath,
      chatAction: input.chatAction,
      userMessage: input.userMessage,
      assistantText: input.assistantText,
      debugMeta: input.debugMeta,
    })
    const saved = await this.repo.save(entity)
    this.logger.log(`[db] insert chat_log OK id=${saved.id} action=${input.chatAction}`)
  }

  private async resyncIdSequence(): Promise<void> {
    await this.repo.query(
      "SELECT setval(pg_get_serial_sequence('chat_log', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM chat_log), 1), (SELECT COALESCE(MAX(id), 0) FROM chat_log) > 0)",
    )
  }

  async list(query: ChatLogListQuery = {}): Promise<ChatLogEntity[]> {
    const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(200, Number(query.limit))) : 50
    const pageResult = await this.listPage({
      page: 1,
      pageSize: limit,
      currentApp: query.currentApp,
      author: query.author,
      conversationId: query.conversationId,
    })
    return pageResult.items
  }

  async listPage(query: ChatLogPageQuery = {}): Promise<ChatLogPageResult> {
    const page = Number.isFinite(query.page) ? Math.max(1, Number(query.page)) : 1
    const pageSize = Number.isFinite(query.pageSize) ? Math.max(1, Math.min(200, Number(query.pageSize))) : 20

    const qb = this.repo
      .createQueryBuilder('log')
      .select([
        'log.id AS id',
        'log.current_app AS "currentApp"',
        'log.current_path AS "currentPath"',
        'log.chat_action AS "chatAction"',
        'log.conversation_id AS "conversationId"',
        'log.user_message AS "userMessage"',
        'log.assistant_text AS "assistantText"',
        'log.debug_meta AS "debugMeta"',
        'log.created_at AS "createdAt"',
      ])

    qb.addSelect('log.author', 'author')

    const currentApp = String(query.currentApp ?? '').trim()
    const author = String(query.author ?? '').trim()
    const conversationId = String(query.conversationId ?? '').trim()

    if (currentApp) {
      qb.where('log.current_app = :currentApp', { currentApp })
    }

    if (author) {
      if (currentApp) qb.andWhere('log.author = :author', { author })
      else qb.where('log.author = :author', { author })
    }

    if (conversationId) {
      if (currentApp || author) qb.andWhere('log.conversation_id = :conversationId', { conversationId })
      else qb.where('log.conversation_id = :conversationId', { conversationId })
    }

    const countQb = qb.clone().select('COUNT(*)', 'count')
    const countRow = await countQb.getRawOne<{ count?: string | number }>()
    const totalRaw = Number(countRow?.count ?? 0)
    const total = Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, totalPages)
    const safeOffset = (safePage - 1) * pageSize

    const rows = await qb
      .orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .offset(safeOffset)
      .limit(pageSize)
      .getRawMany()

    const rawIds = rows
      .map((row: any) => Number(row?.id ?? 0))
      .filter((id: number) => Number.isFinite(id) && id > 0)
    const firstId = rawIds[0]
    const lastId = rawIds.length > 0 ? rawIds[rawIds.length - 1] : undefined
    this.logger.log(
      `[history:listPage] page=${safePage}/${totalPages} pageSize=${pageSize} total=${total} returned=${rows.length} ids(first..last)=${firstId ?? '-'}..${lastId ?? '-'} currentApp=${currentApp || '-'} author=${author || '-'} conversationId=${conversationId || '-'}`,
    )

    const items = rows.map((row: any) => ({
      id: Number(row.id),
      author: String(row.author ?? '').trim() || undefined,
      conversationId: String(row.conversationId ?? '').trim() || undefined,
      currentApp: String(row.currentApp ?? '').trim() || undefined,
      currentPath: String(row.currentPath ?? '').trim() || undefined,
      chatAction: String(row.chatAction ?? '').trim() || undefined,
      userMessage: String(row.userMessage ?? '').trim() || undefined,
      assistantText: String(row.assistantText ?? '').trim() || undefined,
      debugMeta: row.debugMeta && typeof row.debugMeta === 'object'
        ? (row.debugMeta as Record<string, unknown>)
        : undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    }))

    return {
      items,
      page: safePage,
      pageSize,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    }
  }

  async buildHistoryContext(query: {
    author?: string
    conversationId?: string
    currentApp?: string
    hoursBack?: number
    maxTurns?: number
  }): Promise<ChatTurn[]> {
    const hoursBack = Number.isFinite(query.hoursBack)
      ? Math.max(1, Math.min(72, Number(query.hoursBack)))
      : 24
    const maxTurns = Number.isFinite(query.maxTurns)
      ? Math.max(1, Math.min(400, Number(query.maxTurns)))
      : 200

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

    const qb = this.repo
      .createQueryBuilder('log')
      .select([
        'log.user_message AS "userMessage"',
        'log.assistant_text AS "assistantText"',
        'log.created_at AS "createdAt"',
      ])
      .where('log.created_at >= :since', { since })

    const currentApp = String(query.currentApp ?? '').trim()
    if (currentApp) {
      qb.andWhere('log.current_app = :currentApp', { currentApp })
    }

    const author = String(query.author ?? '').trim()
    if (author) {
      qb.andWhere('log.author = :author', { author })
    }

    const conversationId = String(query.conversationId ?? '').trim()
    if (conversationId) {
      qb.andWhere('log.conversation_id = :conversationId', { conversationId })
    }

    const rows = await qb
      .orderBy('log.created_at', 'ASC')
      .addOrderBy('log.id', 'ASC')
      .limit(Math.ceil(maxTurns / 2) + 50)
      .getRawMany()

    const turns: ChatTurn[] = []
    for (const row of rows) {
      const user = String(row.userMessage ?? '').trim()
      const assistant = String(row.assistantText ?? '').trim()
      if (user) turns.push({ role: 'user', content: user })
      if (assistant) turns.push({ role: 'assistant', content: assistant })
    }

    return turns.slice(-maxTurns)
  }
}
