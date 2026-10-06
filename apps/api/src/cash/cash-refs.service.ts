import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type Account = 'cash' | 'bank';
const ACCOUNTS: Account[] = ['cash', 'bank'];
const KINDS = ['expense', 'income'];
// Root collation: Latin names first, then Cyrillic (the 'ru' locale would put Cyrillic first).
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');
const clean = (name: string) => {
  const n = name?.trim();
  if (!n) throw new BadRequestException('Введите название');
  return n;
};
/** Default page for a Salesdoc payment type: «Перечисление» is bank money, everything else cash (spec §6). */
const defaultAccount = (name: string): Account => (/перечисл/i.test(name) ? 'bank' : 'cash');

/** Bank accounts, статьи and the payment-type → page map. Placeholders the owner fills in later. */
@Injectable()
export class CashRefsService {
  constructor(private readonly prisma: PrismaService) {}

  async bankAccounts() {
    const rows = await this.prisma.bankAccount.findMany({ select: { id: true, name: true, active: true } });
    return rows.sort(byName);
  }
  addBankAccount(name: string) {
    return this.prisma.bankAccount.create({ data: { name: clean(name) } });
  }
  async renameBankAccount(id: string, name: string) {
    const r = await this.prisma.bankAccount.updateMany({ where: { id }, data: { name: clean(name) } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }
  async setBankAccountActive(id: string, active: boolean) {
    const r = await this.prisma.bankAccount.updateMany({ where: { id }, data: { active } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }

  async categories() {
    const rows = await this.prisma.cashCategory.findMany({ select: { id: true, name: true, kind: true, active: true } });
    return rows.sort(byName);
  }
  async addCategory(name: string, kind: string) {
    const n = clean(name);
    if (!KINDS.includes(kind)) throw new BadRequestException('Неверный вид статьи');
    return this.prisma.cashCategory.create({ data: { name: n, kind } });
  }
  async renameCategory(id: string, name: string) {
    const r = await this.prisma.cashCategory.updateMany({ where: { id }, data: { name: clean(name) } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }
  async setCategoryActive(id: string, active: boolean) {
    const r = await this.prisma.cashCategory.updateMany({ where: { id }, data: { active } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }

  async paymentTypeAccounts() {
    const [types, set] = await Promise.all([
      this.prisma.paymentType.findMany({ select: { sdId: true, name: true } }),
      this.prisma.paymentTypeAccount.findMany(),
    ]);
    const chosen = new Map(set.map((s) => [s.paymentTypeSdId, s.account as Account]));
    return types.map((t) => ({ sdId: t.sdId, name: t.name, account: chosen.get(t.sdId) ?? defaultAccount(t.name) })).sort(byName);
  }
  async setPaymentTypeAccount(sdId: string, account: string) {
    if (!ACCOUNTS.includes(account as Account)) throw new BadRequestException('Неверный счёт');
    await this.prisma.paymentTypeAccount.upsert({ where: { paymentTypeSdId: sdId }, create: { paymentTypeSdId: sdId, account }, update: { account } });
  }
  async accountOfPaymentType(): Promise<Map<string, Account>> {
    return new Map((await this.paymentTypeAccounts()).map((p) => [p.sdId, p.account]));
  }
}
