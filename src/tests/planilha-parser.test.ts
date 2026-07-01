import { describe, it, expect } from 'vitest';
import { PlanilhaParserService, type ParseResult } from '../services/PlanilhaParserService';
import path from 'path';

describe('PlanilhaParserService', () => {
  describe('parseBRL', () => {
    it('converte string no formato brasileiro', () => {
      expect(PlanilhaParserService.parseBRL('R$ 1.234,56')).toBe(1234.56);
    });

    it('converte número direto', () => {
      expect(PlanilhaParserService.parseBRL(1500)).toBe(1500);
    });

    it('retorna 0 para null/undefined', () => {
      expect(PlanilhaParserService.parseBRL(null)).toBe(0);
      expect(PlanilhaParserService.parseBRL(undefined)).toBe(0);
      expect(PlanilhaParserService.parseBRL('')).toBe(0);
    });

    it('converte string com pontos e vírgula', () => {
      expect(PlanilhaParserService.parseBRL('1.500,50')).toBe(1500.50);
    });

    it('converte valor sem R$', () => {
      expect(PlanilhaParserService.parseBRL('99,90')).toBe(99.90);
    });
  });

  describe('parseDate', () => {
    it('converte formato brasileiro DD/MM/YYYY', () => {
      expect(PlanilhaParserService.parseDate('15/03/2024')).toBe('2024-03-15');
    });

    it('converte formato ISO YYYY-MM-DD', () => {
      expect(PlanilhaParserService.parseDate('2024-03-15')).toBe('2024-03-15');
    });

    it('retorna undefined para valores vazios', () => {
      expect(PlanilhaParserService.parseDate(null)).toBeUndefined();
      expect(PlanilhaParserService.parseDate('')).toBeUndefined();
    });

    it('converte data com mês/dia sem zero', () => {
      expect(PlanilhaParserService.parseDate('5/3/2024')).toBe('2024-03-05');
    });
  });

  describe('normalizePaymentMethod', () => {
    it('reconhece PIX', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('PIX')).toBe('PIX');
    });

    it('reconhece DINHEIRO', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('dinheiro')).toBe('DINHEIRO');
    });

    it('reconhece CREDIARIO', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('fiado')).toBe('CREDIARIO');
      expect(PlanilhaParserService.normalizePaymentMethod('crediário')).toBe('CREDIARIO');
      expect(PlanilhaParserService.normalizePaymentMethod('a prazo')).toBe('CREDIARIO');
    });

    it('reconhece CARTAO_CREDITO', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('crédito')).toBe('CARTAO_CREDITO');
      expect(PlanilhaParserService.normalizePaymentMethod('credito a vista')).toBe('CARTAO_CREDITO');
    });

    it('reconhece CARTAO_DEBITO', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('débito')).toBe('CARTAO_DEBITO');
    });

    it('default para PIX se não reconhecer', () => {
      expect(PlanilhaParserService.normalizePaymentMethod('')).toBe('PIX');
      expect(PlanilhaParserService.normalizePaymentMethod(undefined)).toBe('PIX');
    });
  });

  describe('detectSheetType', () => {
    it('detecta PRODUTOS por colunas de custo, venda e estoque', () => {
      const type = PlanilhaParserService.detectSheetType([
        { nome: 'Produto A', custo: '10', venda: '25', estoque: '5' }
      ]);
      expect(type).toBe('PRODUTOS');
    });

    it('detecta VENDAS por colunas de produto, quantidade e data', () => {
      const type = PlanilhaParserService.detectSheetType([
        { data: '01/01/2024', 'produto nome': 'Tênis', quantidade: '2', 'valor unitário': '100' }
      ]);
      expect(type).toBe('VENDAS');
    });

    it('detecta CLIENTES por colunas de nome e telefone', () => {
      const type = PlanilhaParserService.detectSheetType([
        { nome: 'João', telefone: '11999999999', cpf: '12345678901' }
      ]);
      expect(type).toBe('CLIENTES');
    });
  });
});
