import { useEffect, useRef, useState, useCallback } from 'react';
import { resolveWebSocketUrl } from '../utils/websocket';

export function useWebSocket(url, options = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const maxReconnectAttempts = options.maxReconnectAttempts || 5;
  const reconnectInterval = options.reconnectInterval || 3000;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const wsUrl = resolveWebSocketUrl(url);

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        reconnectAttempts.current = 0;
        if (options.onOpen) options.onOpen();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          if (options.onMessage) options.onMessage(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (options.onError) options.onError(error);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        if (options.onClose) options.onClose();

        // Auto-reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          console.log(`Reconnecting... (attempt ${reconnectAttempts.current})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket connection:', err);
    }
  }, [url, maxReconnectAttempts, reconnectInterval, options]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    send,
    disconnect,
    reconnect: connect
  };
}
