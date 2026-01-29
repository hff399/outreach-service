'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, QrCode, Lock, CheckCircle, AlertCircle, Phone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { accountsApi, ApiError } from '@/lib/api';

type AuthStep = 'choose' | 'qr' | 'phone' | 'code' | '2fa' | 'success';

type Account = {
  id: string;
  phone: string;
  status: string;
};

type AuthDialogProps = {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AuthDialog({ account, open, onOpenChange }: AuthDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<AuthStep>('qr');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'qr' | 'phone'>('qr');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const resetState = () => {
    setStep('qr');
    setQrUrl(null);
    setPhoneCodeHash('');
    setCode('');
    setPassword('');
    setError(null);
    setAuthMethod('qr');
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  // QR Code auth mutations
  const startQrMutation = useMutation({
    mutationFn: () => {
      if (!account) throw new Error('No account selected');
      return accountsApi.startQrAuth(account.id);
    },
    onSuccess: (data) => {
      setQrUrl(data.qrUrl);
      setStep('qr');
      setError(null);
      startPolling();
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  const pollQrMutation = useMutation({
    mutationFn: () => {
      if (!account) throw new Error('No account selected');
      return accountsApi.pollQrAuth(account.id);
    },
    onSuccess: (data) => {
      if (data.status === 'success') {
        stopPolling();
        setStep('success');
        setError(null);
        queryClient.invalidateQueries({ queryKey: ['accounts'] });
      } else if (data.status === '2fa_required') {
        stopPolling();
        setStep('2fa');
        setError(null);
      } else if (data.qrUrl) {
        setQrUrl(data.qrUrl);
      }
    },
    onError: (err: ApiError) => {
      if (err.code === 'QR_EXPIRED' || err.message?.includes('disconnected') || err.message?.includes('Auth session not found')) {
        stopPolling();
        setQrUrl(null);
        setError('Session expired. Generating new QR code...');
        setTimeout(() => {
          setError(null);
          startQrMutation.mutate();
        }, 1000);
      } else {
        setError(err.message);
      }
    },
  });

  const complete2FAMutation = useMutation({
    mutationFn: () => {
      if (!account) throw new Error('No account selected');
      return authMethod === 'qr'
        ? accountsApi.completeQr2FA(account.id, password)
        : accountsApi.completeAuth(account.id, { code, phone_code_hash: phoneCodeHash, password });
    },
    onSuccess: () => {
      setStep('success');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  // Phone code auth mutations
  const startPhoneMutation = useMutation({
    mutationFn: () => {
      if (!account) throw new Error('No account selected');
      return accountsApi.startAuth(account.id);
    },
    onSuccess: (data) => {
      setPhoneCodeHash(data.phoneCodeHash);
      setStep('code');
      setError(null);
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  const completePhoneMutation = useMutation({
    mutationFn: () => {
      if (!account) throw new Error('No account selected');
      return accountsApi.completeAuth(account.id, {
        code,
        phone_code_hash: phoneCodeHash,
        password: password || undefined,
      });
    },
    onSuccess: () => {
      setStep('success');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: ApiError) => {
      if (err.code === '2FA_REQUIRED') {
        setStep('2fa');
        setError(null);
      } else {
        setError(err.message);
      }
    },
  });

  const startPolling = () => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      // Don't poll if already polling or if we have an error
      if (!pollQrMutation.isPending) {
        pollQrMutation.mutate();
      }
    }, 3000); // Poll every 3 seconds
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  // Start QR auth when dialog opens
  useEffect(() => {
    if (open && account && authMethod === 'qr' && !qrUrl && !startQrMutation.isPending) {
      startQrMutation.mutate();
    }

    // Cleanup on unmount or close
    return () => {
      stopPolling();
    };
  }, [open, account?.id, authMethod]);

  // Stop polling when dialog closes
  useEffect(() => {
    if (!open) {
      stopPolling();
    }
  }, [open]);

  const handleMethodChange = (method: string) => {
    stopPolling();
    setAuthMethod(method as 'qr' | 'phone');
    setError(null);
    if (method === 'qr') {
      setStep('qr');
      if (!qrUrl) {
        startQrMutation.mutate();
      } else {
        startPolling();
      }
    } else {
      setStep('phone');
    }
  };

  const renderQrStep = () => (
    <div className="space-y-4">
      <div className="flex justify-center">
        {startQrMutation.isPending ? (
          <div className="w-48 h-48 flex items-center justify-center bg-muted rounded-lg">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : qrUrl ? (
          <div className="p-4 bg-white rounded-lg">
            <QRCodeSVG value={qrUrl} size={180} level="M" />
          </div>
        ) : (
          <div className="w-48 h-48 flex items-center justify-center bg-muted rounded-lg">
            <QrCode className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium">Scan with Telegram</p>
        <ol className="text-sm text-muted-foreground text-left space-y-1">
          <li>1. Open Telegram on your phone</li>
          <li>2. Go to Settings → Devices → Link Desktop Device</li>
          <li>3. Scan this QR code</li>
        </ol>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="outline"
        className="w-full"
        onClick={() => startQrMutation.mutate()}
        disabled={startQrMutation.isPending}
      >
        {startQrMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Refresh QR Code
      </Button>
    </div>
  );

  const renderPhoneStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
        <Phone className="w-8 h-8 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-muted-foreground">Send verification code to</p>
        <p className="text-lg font-semibold mt-1">{account?.phone}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        className="w-full"
        onClick={() => startPhoneMutation.mutate()}
        disabled={startPhoneMutation.isPending}
      >
        {startPhoneMutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending code...
          </>
        ) : (
          'Send Verification Code'
        )}
      </Button>
    </div>
  );

  const renderCodeStep = () => (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-muted-foreground">Enter the code sent to</p>
        <p className="text-sm text-muted-foreground">{account?.phone}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="code">Verification Code</Label>
        <Input
          id="code"
          type="text"
          inputMode="numeric"
          placeholder="12345"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          maxLength={6}
          className="text-center text-2xl tracking-widest"
          autoFocus
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setStep('phone')}>
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={() => completePhoneMutation.mutate()}
          disabled={completePhoneMutation.isPending || code.length < 4}
        >
          {completePhoneMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Verify
        </Button>
      </div>
    </div>
  );

  const render2FAStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
        <Lock className="w-8 h-8 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-muted-foreground">
          Two-factor authentication is enabled. Enter your password.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">2FA Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Enter your 2FA password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        className="w-full"
        onClick={() => complete2FAMutation.mutate()}
        disabled={complete2FAMutation.isPending || !password}
      >
        {complete2FAMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Authenticate
      </Button>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-green-500/10">
        <CheckCircle className="w-8 h-8 text-green-500" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold">Authentication Successful!</p>
        <p className="text-muted-foreground mt-1">
          Account {account?.phone} is now connected
        </p>
      </div>
      <Button className="w-full" onClick={() => handleOpenChange(false)}>
        Done
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? 'Connected' : 'Authenticate Account'}
          </DialogTitle>
          <DialogDescription>
            {step === 'success'
              ? 'Your account is ready to use'
              : 'Connect your Telegram account'}
          </DialogDescription>
        </DialogHeader>

        {step === 'success' ? (
          renderSuccessStep()
        ) : step === '2fa' ? (
          render2FAStep()
        ) : step === 'code' ? (
          renderCodeStep()
        ) : (
          <Tabs value={authMethod} onValueChange={handleMethodChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="qr">QR Code</TabsTrigger>
              <TabsTrigger value="phone">Phone Code</TabsTrigger>
            </TabsList>
            <TabsContent value="qr" className="mt-4">
              {renderQrStep()}
            </TabsContent>
            <TabsContent value="phone" className="mt-4">
              {renderPhoneStep()}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
