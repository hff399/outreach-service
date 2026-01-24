'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit, Copy, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { templatesApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Template = {
  id: string;
  name: string;
  content: string;
  variables: string[];
  created_at: string;
  updated_at: string;
};

export default function TemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '' });
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list() as Promise<Template[]>,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; content: string }) => templatesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setShowCreateForm(false);
      setNewTemplate({ name: '', content: '' });
      toast({ title: 'Template created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast({ title: 'Template deleted' });
    },
  });

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({ title: 'Copied to clipboard' });
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Message Templates</h1>
          <p className="text-muted-foreground">
            Reusable templates for campaigns and sequences
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create Template</CardTitle>
            <CardDescription>
              Use {'{{variable}}'} syntax for dynamic content
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Template name"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Content</label>
              <textarea
                placeholder="Hello {{name}}! We are looking for..."
                value={newTemplate.content}
                onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                className="w-full min-h-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => createMutation.mutate(newTemplate)}
                disabled={!newTemplate.name || !newTemplate.content || createMutation.isPending}
              >
                Create
              </Button>
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Templates Grid */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates?.map((template) => (
            <Card key={template.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{template.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(template.content)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(template.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {template.content}
                </p>
                {template.variables.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {template.variables.map((variable) => (
                      <Badge key={variable} variant="secondary" className="text-xs">
                        {'{{'}{variable}{'}}'}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {templates?.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-8 text-center text-muted-foreground">
                No templates yet. Click "New Template" to create one.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
