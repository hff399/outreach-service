'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Phone, KeyRound, Lock, CheckCircle, AlertCircle } from 'lucide-react';
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
import { accountsApi, ApiError } from '@/lib/api';

type AuthStep = 'phone' | 'code' | '2fa' | 'success';

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
  const [step, setStep] = useState<AuthStep>('phone');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setStep('phone');
    setPhoneCodeHash('');
    setCode('');
    setPassword('');
    setError(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const startAuthMutation = useMutation({
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

  const completeAuthMutation = useMutation({
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

  const handleStartAuth = () => {
    setError(null);
    startAuthMutation.mutate();
  };

  const handleSubmitCode = () => {
    if (!code || code.length < 4) {
      setError('Please enter the verification code');
      return;
    }
    setError(null);
    completeAuthMutation.mutate();
  };

  const handleSubmit2FA = () => {
    if (!password) {
      setError('Please enter your 2FA password');
      return;
    }
    setError(null);
    completeAuthMutation.mutate();
  };

  const renderStep = () => {
    switch (step) {
      case 'phone':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
              <Phone className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-muted-foreground">
                We will send a verification code to
              </p>
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
              onClick={handleStartAuth}
              disabled={startAuthMutation.isPending}
            >
              {startAuthMutation.isPending ? (
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

      case 'code':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
              <KeyRound className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-muted-foreground">
                Enter the code sent to Telegram
              </p>
              <p className="text-sm text-muted-foreground mt-1">{account?.phone}</p>
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
                onClick={handleSubmitCode}
                disabled={completeAuthMutation.isPending || code.length < 4}
              >
                {completeAuthMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify'
                )}
              </Button>
            </div>
          </div>
        );

      case '2fa':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-muted-foreground">
                This account has two-factor authentication enabled.
                Please enter your password.
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
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('code')}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmit2FA}
                disabled={completeAuthMutation.isPending || !password}
              >
                {completeAuthMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Authenticate'
                )}
              </Button>
            </div>
          </div>
        );

      case 'success':
        return (
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
    }
  };

  const getTitle = () => {
    switch (step) {
      case 'phone':
        return 'Authenticate Account';
      case 'code':
        return 'Enter Verification Code';
      case '2fa':
        return 'Two-Factor Authentication';
      case 'success':
        return 'Connected';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>
            {step === 'phone' && 'Connect your Telegram account to start sending messages'}
            {step === 'code' && 'Check your Telegram app for the verification code'}
            {step === '2fa' && 'Additional security verification required'}
            {step === 'success' && 'Your account is ready to use'}
          </DialogDescription>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
