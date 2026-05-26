#!/usr/bin/env tsx
/**
 * Maison Gourmande — Interactive CLI Chat
 *
 * Start a conversation with the AI restaurant concierge.
 * Run: npm run chat
 */

import "dotenv/config";
import * as readline from "node:readline";
import { chat, newConversation } from "../services/agent.js";
import { getOrderSummary, clearCart } from "../services/order-engine.js";
import type { Order } from "../types/order.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

// ============================================================================
// Colors (ANSI)
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// ============================================================================
// Welcome
// ============================================================================

console.log("");
console.log(`  ${YELLOW}🍽️  ${BOLD}Maison Gourmande Concierge${RESET}`);
console.log(`  ${DIM}AI Restaurant Assistant — Abidjan${RESET}`);
console.log(`  ${DIM}Type /help for commands, /quit to exit${RESET}`);
console.log("");

// ============================================================================
// State
// ============================================================================

let { history, order } = newConversation();

// ============================================================================
// Commands
// ============================================================================

function handleCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/);
  const name = parts[0]?.toLowerCase();

  switch (name) {
    case "/help":
      console.log(`  ${DIM}Commands:${RESET}`);
      console.log(`  ${DIM}  /order   — Show current order${RESET}`);
      console.log(`  ${DIM}  /clear   — Clear cart and start fresh${RESET}`);
      console.log(`  ${DIM}  /reset   — Full reset (new conversation)${RESET}`);
      console.log(`  ${DIM}  /quit    — Exit${RESET}`);
      console.log("");
      return true;

    case "/order":
      console.log(`\n${CYAN}${getOrderSummary(order)}${RESET}\n`);
      return true;

    case "/clear": {
      const result = clearCart(order);
      order = result.order;
      console.log(`  ${YELLOW}Cart cleared${RESET}\n`);
      return true;
    }

    case "/reset":
      const fresh = newConversation();
      history = fresh.history;
      order = fresh.order;
      console.log(`  ${YELLOW}New conversation started${RESET}\n`);
      return true;

    case "/quit":
    case "/exit":
      console.log(`  ${DIM}Goodbye! 👋${RESET}\n`);
      process.exit(0);

    default:
      console.log(`  ${DIM}Unknown command: ${name}. Type /help for commands.${RESET}\n`);
      return true;
  }
}

// ============================================================================
// Chat Loop
// ============================================================================

async function processMessage(input: string): Promise<void> {
  // Check for commands
  if (input.startsWith("/")) {
    handleCommand(input);
    return;
  }

  // Show thinking indicator
  process.stdout.write(`  ${DIM}...${RESET}`);

  try {
    const result = await chat(input, history, order);
    history = result.history;
    order = result.order;

    // Clear thinking indicator and show reply
    process.stdout.write(`\r${GREEN}AI${RESET}  ${result.reply}\n\n`);
  } catch (error) {
    process.stdout.write(`\r`);
    if (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")) {
      console.log(`  ${YELLOW}⚠️  ${error.message}${RESET}\n`);
    } else {
      console.error(`  ${YELLOW}Error: ${error instanceof Error ? error.message : "Unknown error"}${RESET}\n`);
    }
  }

  prompt();
}

// ============================================================================
// Readline Setup
// ============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function prompt(): void {
  rl.question(`${GREEN}You${RESET}  `, (answer: string) => {
    const trimmed = answer.trim();
    if (trimmed) {
      processMessage(trimmed);
    } else {
      prompt();
    }
  });
}

// Handle Ctrl+C
rl.on("SIGINT", () => {
  console.log(`\n  ${DIM}Goodbye! 👋${RESET}\n`);
  process.exit(0);
});

// Start
prompt();
