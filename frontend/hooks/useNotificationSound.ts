import { useCallback, useEffect, useRef } from 'react';
import { getChats, getOrders } from '../services/api';
import { ChatConversation, Order } from '../types';

type BrowserAudioContext = typeof AudioContext;

const AudioContextCtor = (): BrowserAudioContext | undefined => {
  return window.AudioContext || (window as unknown as { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext;
};

const getOrderKey = (order: Order) => order.order_id || order.id;

const getConversationKey = (conversation: ChatConversation) => (
  `${conversation.cookie_id}:${conversation.chat_id}`
);

const getLatestBuyerMessageMap = (conversations: ChatConversation[]) => {
  const map = new Map<string, number>();

  conversations.forEach((conversation) => {
    if (conversation.last_role !== 'buyer') return;
    map.set(getConversationKey(conversation), Number(conversation.last_message_id || 0));
  });

  return map;
};

const hasNewBuyerMessage = (
  previous: Map<string, number>,
  conversations: ChatConversation[]
) => {
  return conversations.some((conversation) => {
    if (conversation.last_role !== 'buyer') return false;
    const messageId = Number(conversation.last_message_id || 0);
    const previousMessageId = previous.get(getConversationKey(conversation)) || 0;
    return messageId > previousMessageId;
  });
};

const hasNewOrder = (previous: Set<string>, orders: Order[]) => {
  return orders.some((order) => {
    const key = getOrderKey(order);
    return key && !previous.has(key);
  });
};

export const useNotificationSound = (enabled: boolean) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const chatBaselineReadyRef = useRef(false);
  const orderBaselineReadyRef = useRef(false);
  const buyerMessageMapRef = useRef<Map<string, number>>(new Map());
  const orderIdsRef = useRef<Set<string>>(new Set());
  const lastPlayedAtRef = useRef(0);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const Ctor = AudioContextCtor();
      if (!Ctor) return null;
      audioContextRef.current = new Ctor();
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const playDingDong = useCallback(() => {
    const now = Date.now();
    if (now - lastPlayedAtRef.current < 1200) return;

    const audioContext = ensureAudioContext();
    if (!audioContext || audioContext.state === 'suspended') return;

    lastPlayedAtRef.current = now;
    const masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0.001, audioContext.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.22, audioContext.currentTime + 0.018);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.82);
    masterGain.connect(audioContext.destination);

    [
      { frequency: 987.77, start: 0, duration: 0.2, gain: 0.95 },
      { frequency: 659.25, start: 0.18, duration: 0.34, gain: 0.78 },
    ].forEach(({ frequency, start, duration, gain }) => {
      const oscillator = audioContext.createOscillator();
      const noteGain = audioContext.createGain();
      const startAt = audioContext.currentTime + start;
      const stopAt = startAt + duration;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      noteGain.gain.setValueAtTime(0.001, startAt);
      noteGain.gain.exponentialRampToValueAtTime(gain, startAt + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.001, stopAt);

      oscillator.connect(noteGain);
      noteGain.connect(masterGain);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.03);
    });
  }, [ensureAudioContext]);

  useEffect(() => {
    const unlock = () => {
      void ensureAudioContext()?.resume();
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ensureAudioContext]);

  useEffect(() => {
    if (!enabled) {
      chatBaselineReadyRef.current = false;
      orderBaselineReadyRef.current = false;
      buyerMessageMapRef.current = new Map();
      orderIdsRef.current = new Set();
      return;
    }

    let stopped = false;

    const checkChats = async () => {
      try {
        const response = await getChats();
        if (stopped) return;
        const conversations = response.data || [];

        if (chatBaselineReadyRef.current && hasNewBuyerMessage(buyerMessageMapRef.current, conversations)) {
          playDingDong();
        }

        buyerMessageMapRef.current = getLatestBuyerMessageMap(conversations);
        chatBaselineReadyRef.current = true;
      } catch (error) {
        console.warn('Notification chat polling failed:', error);
      }
    };

    const checkOrders = async () => {
      try {
        const response = await getOrders(undefined, 'all', 1, 20);
        if (stopped) return;
        const orders = response.data || [];

        if (orderBaselineReadyRef.current && hasNewOrder(orderIdsRef.current, orders)) {
          playDingDong();
        }

        orderIdsRef.current = new Set(orders.map(getOrderKey).filter(Boolean));
        orderBaselineReadyRef.current = true;
      } catch (error) {
        console.warn('Notification order polling failed:', error);
      }
    };

    void checkChats();
    void checkOrders();

    const chatTimer = window.setInterval(() => void checkChats(), 5000);
    const orderTimer = window.setInterval(() => void checkOrders(), 10000);

    return () => {
      stopped = true;
      window.clearInterval(chatTimer);
      window.clearInterval(orderTimer);
    };
  }, [enabled, playDingDong]);
};
